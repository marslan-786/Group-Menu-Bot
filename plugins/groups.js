const { proto } = require("@whiskeysockets/baileys"); 

// --- HELPER: CARD MAKER ---
const makeCard = (title, body, footer = "Bot Notification") => {
    return `╭━━〔 *${title}* 〕━━┈\n┃ ${body}\n┃\n┃ ⚡ *${footer}*\n╰━━━━━━━━━━━━━━┈`;
};

module.exports = {
    // --- 👢 KICK USER ---
    kick: {
        category: 'Group',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        execute: async (sock, m, { args, reply, from }) => {
            let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return reply('⚠️ Kisi user ko Reply karein ya Tag karein kick karne ke liye.');
            
            await sock.sendMessage(from, { react: { text: '👢', key: m.key } });

            try {
                await sock.groupParticipantsUpdate(from, [target], 'remove');
                // Card Reply
                const text = `👤 *Target:* @${target.split('@')[0]}\n🚫 *Action:* User Removed (Kick)\n👮 *By:* Admin`;
                await sock.sendMessage(from, { text: makeCard('👢 USER KICKED', text), mentions: [target] });
            } catch (e) {
                reply('❌ Error: User remove nahi ho saka.');
            }
        }
    },

    // --- ➕ ADD USER ---
    add: {
        category: 'Group',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        execute: async (sock, m, { args, reply, from }) => {
            if (!args[0]) return reply('⚠️ Number likhein add karne ke liye.\nEx: #add 923001234567');

            let user = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            await sock.sendMessage(from, { react: { text: '➕', key: m.key } });

            try {
                const res = await sock.groupParticipantsUpdate(from, [user], 'add');
                if (res[0].status === '403') {
                    reply(makeCard('⚠️ PRIVACY ISSUE', `👤 User: @${user.split('@')[0]}\n❌ Masla: User ki privacy lagi hai.\n✉️ Invite link bhej dia gya hai.`));
                } else {
                    reply(makeCard('✅ USER ADDED', `👤 User: @${user.split('@')[0]}\n🎉 Status: Successfully Added!`));
                }
            } catch (e) {
                reply('❌ Error adding user.');
            }
        }
    },

    // --- ⬆️ PROMOTE ---
    promote: {
        category: 'Group',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        execute: async (sock, m, { reply, from }) => {
            let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return reply('⚠️ Reply karein promote karne ke liye.');

            await sock.sendMessage(from, { react: { text: '⬆️', key: m.key } });

            try {
                await sock.groupParticipantsUpdate(from, [target], 'promote');
                const text = `👤 *User:* @${target.split('@')[0]}\n👑 *New Role:* Admin\n🎉 Mubarak ho!`;
                await sock.sendMessage(from, { text: makeCard('⬆️ ADMIN PROMOTED', text), mentions: [target] });
            } catch (e) { reply('❌ Error.'); }
        }
    },

    // --- ⬇️ DEMOTE ---
    demote: {
        category: 'Group',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        execute: async (sock, m, { reply, from }) => {
            let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return reply('⚠️ Reply karein demote karne ke liye.');

            await sock.sendMessage(from, { react: { text: '⬇️', key: m.key } });

            try {
                await sock.groupParticipantsUpdate(from, [target], 'demote');
                const text = `👤 *User:* @${target.split('@')[0]}\n📉 *New Role:* Member\n⚠️ Admin power wapis le li gayi.`;
                await sock.sendMessage(from, { text: makeCard('⬇️ ADMIN DEMOTED', text), mentions: [target] });
            } catch (e) { reply('❌ Error.'); }
        }
    },

    // --- 📣 TAG ALL ---
    tagall: {
        category: 'Group',
        groupOnly: true,
        adminOnly: true,
        execute: async (sock, m, { text, from, reply }) => {
            await sock.sendMessage(from, { react: { text: '📣', key: m.key } });

            const meta = await sock.groupMetadata(from);
            const parts = meta.participants.map(p => p.id);
            
            let msg = `📣 *EVERYONE MENTION*\n\n📝 *Message:* ${text || 'Khabardaar!'}\n\n`;
            msg += parts.map(p => `@${p.split('@')[0]}`).join('\n');
            
            // Simple text for tagall to avoid huge card spam
            await sock.sendMessage(from, { text: msg, mentions: parts }, { quoted: m });
        }
    },

    // --- 👻 HIDETAG ---
    hidetag: {
        category: 'Group',
        groupOnly: true,
        adminOnly: true,
        execute: async (sock, m, { text, from, reply }) => {
            const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!text && !quoted) return reply('⚠️ Text likhein.');

            await sock.sendMessage(from, { react: { text: '👻', key: m.key } });
            const meta = await sock.groupMetadata(from);
            const parts = meta.participants.map(p => p.id);

            if (quoted) {
                 await sock.sendMessage(from, { text: text || '.', mentions: parts }, { quoted: m });
            } else {
                 await sock.sendMessage(from, { text: text, mentions: parts });
            }
        }
    },

    // --- 🔒 GROUP OPEN/CLOSE ---
    group: {
        category: 'Group',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        execute: async (sock, m, { args, reply, from }) => {
            if (!args[0]) return reply('⚠️ Use: *#group open* ya *close*');
            
            const isClose = args[0] === 'close';
            await sock.sendMessage(from, { react: { text: isClose ? '🔒' : '🔓', key: m.key } });

            try {
                await sock.groupSettingUpdate(from, isClose ? 'announcement' : 'not_announcement');
                const text = `🔒 *Status:* Group ${isClose ? 'CLOSED' : 'OPEN'} kar dia gya hai.\nℹ️ *Info:* Ab ${isClose ? 'sirf Admins' : 'sab log'} message kar sakte hain.`;
                reply(makeCard('⚙️ GROUP SETTING', text));
            } catch { reply('❌ Error.'); }
        }
    }
};
