module.exports = {
    owner: {
        category: 'Settings',
        execute: async (sock, m, { from }) => {
            await sock.sendMessage(from, { react: { text: '👤', key: m.key } });
            const setting = require('../settings');
            const vcard = 'BEGIN:VCARD\nVERSION:3.0\n' + `FN:${settings.ownerName}\nTEL;type=CELL;waid=${settings.ownerNumber}:${settings.ownerNumber}\nEND:VCARD`;
            await sock.sendMessage(from, { contacts: { displayName: settings.ownerName, contacts: [{ vcard }] } }, { quoted: m });
        }
    },

    // --- 👁️ READ ALL STATUS (New Powerful Command) ---
    readallstatus: {
        category: 'Settings',
        ownerOnly: true,
        execute: async (sock, m, { reply, from }) => {
            await sock.sendMessage(from, { react: { text: '⏳', key: m.key } });
            console.log(`\n[CMD DEBUG] #readallstatus initiated by ${m.key.participant || m.key.remoteJid}`);

            try {
                // 1. Attempt using chatModify (Best for clearing the "Green Dot")
                console.log("[DEBUG] Attempting to mark 'status@broadcast' as read...");
                
                await sock.chatModify(
                    { markRead: true, lastMessages: [] }, 
                    'status@broadcast'
                );

                console.log("[SUCCESS] 'status@broadcast' marked as read successfully!");
                await sock.sendMessage(from, { react: { text: '✅', key: m.key } });
                return reply("✅ *Success:* Command sent to mark all statuses as read.\n(Check your WhatsApp Status tab now)");

            } catch (err) {
                // 🔥 ERROR LOGGING FOR RAILWAY
                console.error("❌ [CRITICAL ERROR] Failed to read statuses!");
                console.error("❌ Error Message:", err.message);
                console.error("❌ Error Stack:", err.stack);
                
                await sock.sendMessage(from, { react: { text: '❌', key: m.key } });
                return reply(`❌ *Failed to read statuses.*\n\n*Reason:* ${err.message}\n(Check Console Logs for details)`);
            }
        }
    },

    // --- 🟢 ALWAYS ONLINE ---
    alwaysonline: {
        category: 'Settings',
        ownerOnly: true,
        execute: async (sock, m, { args, db, saveDB, reply, from }) => {
            await sock.sendMessage(from, { react: { text: '🌐', key: m.key } });
            if (!db.settings) db.settings = {};

            if (!args[0]) {
                const status = db.settings.alwaysonline ? "ON 🟢" : "OFF 🔴";
                return reply(`🌐 *Always Online:* ${status}\n\nUse: *#alwaysonline on* or *off*`);
            }
            
            db.settings.alwaysonline = args[0] === 'on';
            saveDB(db);
            
            if (db.settings.alwaysonline) {
                await sock.sendPresenceUpdate('available', from);
            } else {
                await sock.sendPresenceUpdate('unavailable', from);
            }

            reply(`✅ Always Online: ${args[0].toUpperCase()}`);
        }
    },

    // --- 🟢 AUTO STATUS VIEW ---
    autostatus: {
        category: 'Settings',
        ownerOnly: true,
        execute: async (sock, m, { args, db, saveDB, reply, from }) => {
            await sock.sendMessage(from, { react: { text: '⚙️', key: m.key } });
            if (!db.settings) db.settings = {};
            
            if (!args[0]) {
                const status = db.settings.autostatus ? "ON 🟢" : "OFF 🔴";
                return reply(`👁️ *Auto Read Status:* ${status}\n\nUse: *#autostatus on* or *off*`);
            }
            
            db.settings.autostatus = args[0] === 'on';
            saveDB(db);
            
            console.log(`[SETTINGS] AutoStatus changed to: ${args[0]}`); // Log added
            reply(`✅ Auto Status View: ${args[0].toUpperCase()}`);
        }
    },

    // --- 💚 AUTO STATUS REACT ---
    statusreact: {
        category: 'Settings',
        ownerOnly: true,
        execute: async (sock, m, { args, db, saveDB, reply, from }) => {
            await sock.sendMessage(from, { react: { text: '🎭', key: m.key } });
            if (!db.settings) db.settings = {};

            if (!args[0]) {
                const status = db.settings.autosreact ? "ON 🟢" : "OFF 🔴";
                return reply(`🎭 *Auto React Status:* ${status}\n\nUse: *#statusreact on* or *off*`);
            }
            
            db.settings.autosreact = args[0] === 'on';
            saveDB(db);
            
            console.log(`[SETTINGS] StatusReact changed to: ${args[0]}`); // Log added
            reply(`✅ Auto Status React (Multi-Emoji): ${args[0].toUpperCase()}`);
        }
    },

    // --- 🎯 CUSTOM TARGETS ---
    addstatus: {
        category: 'Settings',
        ownerOnly: true,
        execute: async (sock, m, { args, db, saveDB, reply, from }) => {
            await sock.sendMessage(from, { react: { text: '🎯', key: m.key } });
            if (!args[0]) return reply('⚠️ Enter number.\nEx: #addstatus 923001234567');
            if (!db.settings.status_targets) db.settings.status_targets = [];
            let cleanNum = args[0].replace(/[^0-9]/g, '');
            if (db.settings.status_targets.includes(cleanNum)) return reply('⚠️ Already added.');
            db.settings.status_targets.push(cleanNum);
            saveDB(db);
            reply(`✅ Added to Target List:\n+${cleanNum}`);
        }
    },

    delstatus: {
        category: 'Settings',
        ownerOnly: true,
        execute: async (sock, m, { args, db, saveDB, reply, from }) => {
            await sock.sendMessage(from, { react: { text: '🗑️', key: m.key } });
            if (!args[0]) return reply('⚠️ Enter number.');
            let cleanNum = args[0].replace(/[^0-9]/g, '');
            db.settings.status_targets = (db.settings.status_targets || []).filter(n => n !== cleanNum);
            saveDB(db);
            reply(`🗑️ Removed from Target List.`);
        }
    },

    liststatus: {
        category: 'Settings',
        ownerOnly: true,
        execute: async (sock, m, { db, reply, from }) => {
            await sock.sendMessage(from, { react: { text: '📜', key: m.key } });
            if (!db.settings.status_targets || db.settings.status_targets.length === 0) {
                return reply('📂 *List Empty*');
            }
            reply(`🎯 *Targets:*\n${db.settings.status_targets.map(n => `+${n}`).join('\n')}`);
        }
    },

    // --- GLOBAL SETTINGS ---
    autoread: {
        category: 'Settings',
        ownerOnly: true,
        execute: async (sock, m, { args, db, saveDB, reply, from }) => {
            await sock.sendMessage(from, { react: { text: '👁️', key: m.key } });
            if (!args[0]) return reply(`Current: ${db.settings.autoread ? "ON" : "OFF"}\nUse: #autoread on/off`);
            db.settings.autoread = args[0] === 'on'; saveDB(db);
            reply(`✅ AutoRead: ${args[0].toUpperCase()}`);
        }
    },

    autoreact: {
        category: 'Settings',
        ownerOnly: true,
        execute: async (sock, m, { args, db, saveDB, reply, from }) => {
            await sock.sendMessage(from, { react: { text: '👍', key: m.key } });
            if (!args[0]) return reply(`Current: ${db.settings.autoreact ? "ON" : "OFF"}\nUse: #autoreact on/off`);
            db.settings.autoreact = args[0] === 'on'; saveDB(db);
            reply(`✅ AutoReact: ${args[0].toUpperCase()}`);
        }
    },

    mode: {
        category: 'Settings',
        ownerOnly: true,
        execute: async (sock, m, { args, db, saveDB, reply, from }) => {
            await sock.sendMessage(from, { react: { text: '🔒', key: m.key } });
            if (!args[0]) return reply(`Mode: ${db[from].mode}\nUse: #mode public/private`);
            db[from].mode = args[0]; saveDB(db);
            reply(`✅ Mode set to: ${args[0].toUpperCase()}`);
        }
    },

    // --- SECURITY ---
    antilink: { 
        category: 'Settings', groupOnly: true, adminOnly: true, 
        execute: async (sock, m, { args, db, saveDB, from, sender, reply }) => {
            await sock.sendMessage(from, { react: { text: '🛡️', key: m.key } });
            if(args[0] === 'off') { db[from].antilink = false; saveDB(db); return reply('❌ Antilink OFF'); }
            db[from].setupState = { user: sender, type: 'antilink', step: 1, config: {} }; saveDB(db);
            reply(`⚙️ *Setup Antilink*\nAllow Admin Bypass?\n1. Yes\n2. No`);
        }
    },

    antipic: { 
        category: 'Settings', groupOnly: true, adminOnly: true, 
        execute: async (sock, m, { args, db, saveDB, from, sender, reply }) => {
            await sock.sendMessage(from, { react: { text: '📸', key: m.key } });
            if(args[0] === 'off') { db[from].antipic = false; saveDB(db); return reply('❌ Antipic OFF'); }
            db[from].setupState = { user: sender, type: 'antipic', step: 1, config: {} }; saveDB(db);
            reply(`⚙️ *Setup Antipic*\nAllow Admin Bypass?\n1. Yes\n2. No`);
        }
    },

    antivideo: { 
        category: 'Settings', groupOnly: true, adminOnly: true, 
        execute: async (sock, m, { args, db, saveDB, from, sender, reply }) => {
            await sock.sendMessage(from, { react: { text: '🎥', key: m.key } });
            if(args[0] === 'off') { db[from].antivideo = false; saveDB(db); return reply('❌ Antivideo OFF'); }
            db[from].setupState = { user: sender, type: 'antivideo', step: 1, config: {} }; saveDB(db);
            reply(`⚙️ *Setup Antivideo*\nAllow Admin Bypass?\n1. Yes\n2. No`);
        }
    },

    antisticker: { 
        category: 'Settings', groupOnly: true, adminOnly: true, 
        execute: async (sock, m, { args, db, saveDB, from, sender, reply }) => {
            await sock.sendMessage(from, { react: { text: '🃏', key: m.key } });
            if(args[0] === 'off') { db[from].antisticker = false; saveDB(db); return reply('❌ Antisticker OFF'); }
            db[from].setupState = { user: sender, type: 'antisticker', step: 1, config: {} }; saveDB(db);
            reply(`⚙️ *Setup Antisticker*\nAllow Admin Bypass?\n1. Yes\n2. No`);
        }
    }
};
