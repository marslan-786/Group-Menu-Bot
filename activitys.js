const { 
    downloadContentFromMessage
} = require("@whiskeysockets/baileys");
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const https = require('https');
const settings = require('./settings');

const dbFile = './database.json';
const START_TIME = Date.now();

// Per-bot message cache with auto-cleanup
const INSTANCE_MSG_CACHE = new Map();

const getUptime = () => {
    const ms = Date.now() - START_TIME;
    const s = Math.floor((ms / 1000) % 60);
    const m = Math.floor((ms / (1000 * 60)) % 60);
    const h = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const d = Math.floor(ms / (1000 * 60 * 60 * 24));
    return `${d}d ${h}h ${m}m ${s}s`;
};

const loadDB = () => {
    if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({}, null, 2));
    try { return JSON.parse(fs.readFileSync(dbFile)); } catch { return {}; }
};

const saveDB = (data) => fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));

const getRandom = (ext) => `${Math.floor(Math.random() * 10000)}${ext}`;
const ignoreSSL = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

async function downloadMedia(message, type) {
    try {
        const stream = await downloadContentFromMessage(message, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch { return null; }
}

async function uploadToCatbox(buffer) {
    try {
        const tempPath = getRandom('.jpg');
        fs.writeFileSync(tempPath, buffer);
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('userhash', '');
        form.append('fileToUpload', fs.createReadStream(tempPath));
        const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: { ...form.getHeaders(), 'User-Agent': 'Mozilla/5.0' },
            httpsAgent: ignoreSSL,
            timeout: 30000
        });
        fs.unlinkSync(tempPath);
        return data.trim();
    } catch { return null; }
}

// Plugin system
const commands = new Map();
const pluginsDir = path.join(__dirname, 'plugins');

const loadPlugins = () => {
    commands.clear();
    if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir);
    const files = fs.readdirSync(pluginsDir).filter(file => file.endsWith('.js'));
    
    for (const file of files) {
        try {
            delete require.cache[require.resolve(path.join(pluginsDir, file))];
            const plugin = require(path.join(pluginsDir, file));
            Object.keys(plugin).forEach(cmd => {
                commands.set(cmd, { ...plugin[cmd], type: plugin[cmd].category || 'Others' });
            });
        } catch (e) { 
            console.error(`Plugin load error ${file}:`, e.message);
        } 
    }
    console.log(`✅ ${commands.size} commands loaded`);
};

loadPlugins();

// Clean number helper
const getNum = (str) => {
    if (!str) return "";
    return str.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
};

// Auto cleanup old messages every 5 minutes
setInterval(() => {
    INSTANCE_MSG_CACHE.forEach((cache, botNum) => {
        if (cache.size > 50) {
            const toDelete = Array.from(cache).slice(0, 25);
            toDelete.forEach(id => cache.delete(id));
        }
    });
}, 300000);

module.exports = async (sock, m, botNumber) => {
    try {
        if (!m?.message) return;
        
        // Initialize bot cache
        if (!INSTANCE_MSG_CACHE.has(botNumber)) {
            INSTANCE_MSG_CACHE.set(botNumber, new Set());
        }
        
        const cache = INSTANCE_MSG_CACHE.get(botNumber);
        const msgId = m.key?.id;
        
        // Skip if already processed by THIS bot
        if (msgId && cache.has(msgId)) return;
        if (msgId) cache.add(msgId);
        
        // Load settings
        let db = loadDB();
        if (!db.settings) db.settings = { mode: 'public', prefix: '#' };
        const prefix = db.settings.prefix || '#';

        // ===== STATUS HANDLER =====
        if (m.key.remoteJid === 'status@broadcast') {
            if (!db.settings.autostatus && !db.settings.autosreact) return;
            
            try { await sock.readMessages([m.key]); } catch(e) {}
            
            if (db.settings.autosreact) {
                const emojis = ['💚', '❤️', '🧡', '💛', '💙', '💜'];
                try { 
                    await sock.sendMessage(m.key.remoteJid, { 
                        react: { text: emojis[Math.floor(Math.random() * emojis.length)], key: m.key } 
                    }, { statusJidList: [m.key.participant] }); 
                } catch(e) {}
            }
            return; 
        }

        // ===== EXTRACT MESSAGE TEXT =====
        let msg = m.message;
        if (msg.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message;
        else if (msg.viewOnceMessage) msg = msg.viewOnceMessage.message;
        else if (msg.documentWithCaptionMessage) msg = msg.documentWithCaptionMessage.message;
        else if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message;

        let body = msg.conversation || 
                   msg.extendedTextMessage?.text || 
                   msg.imageMessage?.caption || 
                   msg.videoMessage?.caption || 
                   msg.documentMessage?.caption || 
                   msg.videoMessage?.caption || '';
        
        body = body?.trim() || '';
        if (!body || !body.startsWith(prefix)) return;

        const from = m.key.remoteJid;
        const isGroup = from?.endsWith('@g.us');
        const sender = isGroup ? m.key.participant : from;

        // ===== OWNER CHECK =====
        const botNum = getNum(sock.user?.lid || sock.user?.id);
        const senderNum = getNum(sender);
        const isCreator = (botNum && senderNum) && (botNum === senderNum);
        
        const configOwners = (Array.isArray(settings.ownerNumber) 
            ? settings.ownerNumber 
            : [settings.ownerNumber]).map(n => getNum(n.toString()));
        
        const isOwner = isCreator || m.key.fromMe || configOwners.includes(senderNum);

        // Mode check
        if (db.settings.mode === 'private' && !isOwner) return;

        // ===== ADMIN CHECKS =====
        let isAdmin = false, isBotAdmin = false;
        if (isGroup) {
            try {
                const meta = await sock.groupMetadata(from);
                const participants = meta.participants || [];
                
                isAdmin = participants.find(p => getNum(p.id) === senderNum)?.admin != null;
                isBotAdmin = participants.find(p => getNum(p.id) === botNum)?.admin != null;
            } catch(e) {}
        }

        // Fast reply helper
        const reply = async (t) => {
            try {
                return await sock.sendMessage(from, {text: t}, {quoted: m});
            } catch(e) {
                console.error('Reply error:', e.message);
                return null;
            }
        };

        // ===== PARSE COMMAND =====
        const cmdName = body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase();
        const args = body.trim().split(/\s+/).slice(1);
        const text = args.join(' ');

        // ===== SETPREFIX =====
        if (cmdName === 'setprefix' && isOwner) {
            if (!args[0]) return reply(`Usage: ${prefix}setprefix [symbol]`);
            db.settings.prefix = args[0];
            saveDB(db);
            return reply(`✅ Prefix: *${args[0]}*`);
        }

        // ===== PING COMMAND (ULTRA FAST) =====
        if (cmdName === 'ping') {
            const start = Date.now();
            const sent = await sock.sendMessage(from, { text: '🏓 Pinging...' }, { quoted: m });
            const latency = Date.now() - start;
            
            if (sent?.key) {
                try {
                    await sock.sendMessage(from, {
                        text: `⚡ *Ping:* ${latency}ms\n🕐 *Uptime:* ${getUptime()}`,
                        edit: sent.key
                    });
                } catch(e) {
                    await reply(`⚡ *Ping:* ${latency}ms\n🕐 *Uptime:* ${getUptime()}`);
                }
            } else {
                await reply(`⚡ *Ping:* ${latency}ms\n🕐 *Uptime:* ${getUptime()}`);
            }
            return;
        }

        // ===== MENU COMMAND (FIXED VERSION) =====
        if (['menu', 'help', 'allmenu'].includes(cmdName)) {
            console.log(`[DEBUG] Menu command received from ${from}`);
            
            // ری ایکٹ بھیجیں
            try { 
                await sock.sendMessage(from, { react: { text: '📜', key: m.key } }); 
            } catch(e) {
                console.log('React error:', e.message);
            }
            
            // مینیو بنائیں
            let menu = `╭━━━〔 ${settings.botName || 'BOT'} 〕━━━┈\n`;
            menu += `┃ 👋 *Assalam-o-Alaikum*\n`;
            menu += `┃ 👑 *Owner:* ${settings.ownerName}\n`;
            menu += `┃ 🤖 *Bot:* +${botNumber}\n`;
            menu += `┃ 🛡️ *Mode:* ${db.settings.mode.toUpperCase()}\n`;
            menu += `┃ 📍 *Prefix:* ${prefix}\n`;
            menu += `┃ ⏳ *Uptime:* ${getUptime()}\n`;
            menu += `┃ 📦 *Commands:* ${commands.size}\n`;
            menu += `╰━━━━━━━━━━━━━━━━━━┈\n\n`;
            
            // کمانڈز کی کیٹیگریز
            const categories = {};
            commands.forEach((det, c) => {
                if (!categories[det.type]) categories[det.type] = [];
                categories[det.type].push(c);
            });

            // ہر کیٹیگری کا مینیو
            for (const [cat, list] of Object.entries(categories)) {
                menu += `╭━━〔 ${cat.toUpperCase()} 〕━━┈\n`;
                list.sort().slice(0, 10).forEach(c => menu += `┃ 🔸 ${prefix}${c}\n`);
                if (list.length > 10) menu += `┃ ... ${list.length - 10} more\n`;
                menu += `╰━━━━━━━━━━━━━━━━━━┈\n`;
            }
            
            menu += `\n📝 *Type ${prefix}cmdname for help*\n`;
            menu += `🔗 *Example:* ${prefix}ping\n\n`;
            menu += `© ${new Date().getFullYear()} ${settings.botName || 'Bot'}`;

            console.log(`[DEBUG] Menu length: ${menu.length} chars`);
            
            try {
                // صرف ٹیکسٹ بھیجیں (تصویر کے بغیر)
                const sentMsg = await sock.sendMessage(from, { text: menu }, { quoted: m });
                console.log(`[DEBUG] Menu sent successfully: ${sentMsg?.key?.id}`);
                
                // اگر تصویر موجود ہو تو علیحدہ بھیجیں
                if (fs.existsSync('./pic.png')) {
                    setTimeout(async () => {
                        try {
                            const imgBuffer = fs.readFileSync('./pic.png');
                            if (imgBuffer.length < 5 * 1024 * 1024) { // 5MB سے کم
                                await sock.sendMessage(from, { 
                                    image: imgBuffer,
                                    caption: `🖼️ ${settings.botName || 'Bot'} Profile`
                                });
                            }
                        } catch(imgErr) {
                            console.log(`[DEBUG] Image send failed:`, imgErr.message);
                        }
                    }, 1000);
                }
            } catch (menuErr) {
                console.error('[ERROR] Menu send failed:', menuErr.message);
                
                // فیل بیسک: چھوٹا مینیو
                try {
                    const simpleMenu = `📜 *${settings.botName || 'Bot'} Menu*\n\n` +
                                     `Prefix: ${prefix}\n` +
                                     `Commands: ${commands.size}\n` +
                                     `Uptime: ${getUptime()}\n\n` +
                                     `Type *${prefix}list* for commands`;
                    await reply(simpleMenu);
                } catch(e2) {
                    console.error('[ERROR] Fallback menu also failed:', e2.message);
                }
            }
            return;
        }

        // ===== LIST COMMAND =====
        if (cmdName === 'list') {
            let listMsg = `📋 *Commands List* (${commands.size})\n\n`;
            
            const categories = {};
            commands.forEach((det, c) => {
                if (!categories[det.type]) categories[det.type] = [];
                categories[det.type].push(`${prefix}${c} - ${det.desc || 'No description'}`);
            });
            
            for (const [cat, cmds] of Object.entries(categories)) {
                listMsg += `*${cat.toUpperCase()}*\n`;
                cmds.slice(0, 15).forEach(cmd => listMsg += `• ${cmd}\n`);
                if (cmds.length > 15) listMsg += `• ... ${cmds.length - 15} more\n`;
                listMsg += '\n';
            }
            
            await reply(listMsg);
            return;
        }

        // ===== MODE COMMAND =====
        if (cmdName === 'mode' && isOwner) {
            if (args[0] === 'public' || args[0] === 'private') {
                db.settings.mode = args[0];
                saveDB(db);
                return reply(`✅ Mode: *${args[0].toUpperCase()}*`);
            }
            return reply(`Use: ${prefix}mode public/private`);
        }

        // ===== ID COMMAND =====
        if (cmdName === 'id') {
            const idInfo = `📱 *ID INFORMATION*\n\n` +
                         `👤 *User ID:* ${sender}\n` +
                         `🧹 *Clean:* ${getNum(sender)}\n` +
                         `👥 *Group ID:* ${isGroup ? from : 'Not in group'}\n` +
                         `📞 *Your Number:* ${senderNum || 'Unknown'}\n` +
                         `🤖 *Bot Number:* ${botNum}`;
            return reply(idInfo);
        }

        // ===== PLUGIN EXECUTION =====
        if (commands.has(cmdName)) {
            const plugin = commands.get(cmdName);
            
            // Permission checks
            if (plugin.ownerOnly && !isOwner) {
                return reply('❌ This command is for owner only.');
            }
            
            if (plugin.groupOnly && !isGroup) {
                return reply('❌ This command works in groups only.');
            }
            
            if (plugin.botAdmin && !isBotAdmin) {
                return reply('❌ Bot needs to be admin to use this command.');
            }
            
            if (plugin.admin && !isAdmin && !isOwner) {
                return reply('❌ You need to be admin to use this command.');
            }
            
            // Execute plugin
            try {
                await plugin.execute(sock, m, {
                    args, text, isOwner, isAdmin, isBotAdmin, 
                    db, saveDB, from, sender, downloadMedia, uploadToCatbox, 
                    body, cleanID: getNum, reply, prefix, botNumber,
                    getUptime
                });
            } catch (e) {
                console.error(`Plugin ${cmdName} error:`, e.message);
                await reply(`❌ Error: ${e.message}`);
            }
        }

    } catch (err) { 
        console.error("Handler error:", err.message);
    }
};

// Auto-reload plugins every 30 minutes
setInterval(() => {
    loadPlugins();
    console.log(`🔄 Plugins reloaded at ${new Date().toLocaleTimeString()}`);
}, 1800000);