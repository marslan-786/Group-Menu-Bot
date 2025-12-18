const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const getRandom = (ext) => `${Date.now()}${ext}`;

module.exports = {
    id: {
        category: 'Tools',
        execute: async (sock, m, { from, sender, cleanID, reply }) => {
            await sock.sendMessage(from, { react: { text: '🆔', key: m.key } });
            let idTxt = `🆔 *ID INFO*\n👤 *User:* \`${sender}\`\n(Clean: ${cleanID(sender)})`;
            if (from.endsWith('@g.us')) idTxt += `\n👥 *Group:* \`${from}\``;
            reply(idTxt); 
        }
    },

    ping: {
        category: 'Tools',
        execute: async (sock, m, { reply, from }) => {
            await sock.sendMessage(from, { react: { text: '⚡', key: m.key } });
            // Direct reply using sock to ensure quoting
            await sock.sendMessage(from, { text: `*⚡ Ping:* ${(Date.now() - (m.messageTimestamp * 1000))}ms` }, { quoted: m });
        }
    },

    toimg: {
        category: 'Tools',
        execute: async (sock, m, { downloadMedia, reply, from }) => {
            let q = m.message.extendedTextMessage?.contextInfo?.quotedMessage || m.message;
            if (!q.stickerMessage) return reply('⚠️ Reply to a sticker.');

            await sock.sendMessage(from, { react: { text: '🖼️', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Converting to Image...*' }, { quoted: m });

            try {
                const buff = await downloadMedia(q.stickerMessage, 'sticker');
                const webpPath = getRandom('.webp');
                const pngPath = getRandom('.png');
                
                fs.writeFileSync(webpPath, buff);

                exec(`ffmpeg -i ${webpPath} ${pngPath}`, async (err) => {
                    fs.unlinkSync(webpPath);
                    if (!err) {
                        await sock.sendMessage(from, { image: fs.readFileSync(pngPath), caption: '✅ *Converted*' }, { quoted: m });
                        await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });
                    } else {
                        await sock.sendMessage(from, { text: '❌ Failed to convert.', edit: waitMsg.key });
                    }
                    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
                });
            } catch (e) {
                await sock.sendMessage(from, { text: '❌ Error Occurred.', edit: waitMsg.key });
            }
        }
    },

    tovideo: {
        category: 'Tools',
        execute: async (sock, m, { downloadMedia, reply, from }) => {
            let q = m.message.extendedTextMessage?.contextInfo?.quotedMessage || m.message;
            if (!q.stickerMessage) return reply('⚠️ Reply to an animated sticker.');

            await sock.sendMessage(from, { react: { text: '🎥', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Converting to Video...*' }, { quoted: m });

            try {
                const buff = await downloadMedia(q.stickerMessage, 'sticker');
                const webpPath = getRandom('.webp');
                const mp4Path = getRandom('.mp4');
                
                fs.writeFileSync(webpPath, buff);

                exec(`ffmpeg -i ${webpPath} -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -r 15 -pix_fmt yuv420p ${mp4Path}`, async (err) => {
                    fs.unlinkSync(webpPath);
                    if (!err) {
                        await sock.sendMessage(from, { video: fs.readFileSync(mp4Path), caption: '✅ *Converted*', gifPlayback: true }, { quoted: m });
                        await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });
                    } else {
                        await sock.sendMessage(from, { text: '❌ Failed. Is it an animated sticker?', edit: waitMsg.key });
                    }
                    if (fs.existsSync(mp4Path)) fs.unlinkSync(mp4Path);
                });
            } catch (e) {
                await sock.sendMessage(from, { text: '❌ Error Occurred.', edit: waitMsg.key });
            }
        }
    },
    
    vv: {
        category: 'Tools',
        execute: async (sock, m, { downloadMedia, reply, from }) => {
            let q = m.message.extendedTextMessage?.contextInfo?.quotedMessage;

            let msgType = q ? Object.keys(q)[0] : null;
            if (!q || !['imageMessage', 'videoMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'audioMessage'].includes(msgType)) {
                return reply('⚠️ Reply to any media (Image/Video/Voice/ViewOnce).');
            }

            await sock.sendMessage(from, { react: { text: '🫣', key: m.key } });
            
            try {
                let actualMsg = q;
                if (q.viewOnceMessage) actualMsg = q.viewOnceMessage.message;
                if (q.viewOnceMessageV2) actualMsg = q.viewOnceMessageV2.message;

                let mime = (actualMsg.imageMessage || actualMsg.videoMessage || actualMsg.audioMessage)?.mimetype;
                let type = mime?.split('/')[0] || 'image';
                if (mime?.includes('audio')) type = 'audio';

                const buff = await downloadMedia(actualMsg.imageMessage || actualMsg.videoMessage || actualMsg.audioMessage, type);
                
                if (type === 'video') {
                    await sock.sendMessage(from, { video: buff, caption: '📂 *Retrieved Media*' }, { quoted: m });
                } else if (type === 'image') {
                    await sock.sendMessage(from, { image: buff, caption: '📂 *Retrieved Media*' }, { quoted: m });
                } else if (type === 'audio') {
                    await sock.sendMessage(from, { audio: buff, mimetype: mime, ptt: false }, { quoted: m });
                }
            } catch (e) {
                console.error(e);
                reply('❌ Failed to download media.');
            }
        }
    },

    tourl: {
        category: 'Tools',
        execute: async (sock, m, { downloadMedia, uploadToCatbox, reply, from }) => {
            let q = m.message.extendedTextMessage?.contextInfo?.quotedMessage || m.message;
            let mime = (q.imageMessage || q.videoMessage)?.mimetype || "";
            if (!mime) return reply('⚠️ Reply to media (Image/Video).');

            await sock.sendMessage(from, { react: { text: '⏳', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Uploading to Cloud...*' }, { quoted: m });

            try {
                const buff = await downloadMedia(q.imageMessage || q.videoMessage, mime.startsWith('image') ? 'image' : 'video');
                const url = await uploadToCatbox(buff);
                
                if (!url) {
                    return sock.sendMessage(from, { text: '❌ *Upload Failed!*', edit: waitMsg.key });
                }
                await sock.sendMessage(from, { text: `🔗 *LINK GENERATED*\n\n${url}`, edit: waitMsg.key });
            } catch (e) {
                await sock.sendMessage(from, { text: '❌ *Error Occurred!*', edit: waitMsg.key });
            }
        }
    },

    translate: {
        category: 'Tools',
        execute: async (sock, m, { args, reply, from }) => {
            let trText = m.message.extendedTextMessage?.contextInfo?.quotedMessage?.conversation || args.slice(1).join(" ");
            let lang = args[0] || 'ur';
            if (!trText && args.length > 0) { trText = args.join(" "); lang = 'ur'; }
            if (!trText) return reply('⚠️ Give text to translate.');

            await sock.sendMessage(from, { react: { text: '🌍', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Translating...*' }, { quoted: m });

            try {
                const res = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(trText)}`);
                let resultText = `🌍 *Translation (${lang}):*\n\n${res.data[0][0][0]}`;
                await sock.sendMessage(from, { text: resultText, edit: waitMsg.key });
            } catch { 
                await sock.sendMessage(from, { text: '❌ Translation Error.', edit: waitMsg.key });
            }
        }
    },

    data: {
        category: 'Tools',
        execute: async (sock, m, { args, reply, from }) => {
            if (!args[0]) return reply('⚠️ Enter number.');
            let sNum = args[0].replace(/[^0-9]/g, '');
            if (sNum.startsWith('92')) sNum = '0' + sNum.slice(2);

            await sock.sendMessage(from, { react: { text: '🔍', key: m.key } });
            let lMsg = await sock.sendMessage(from, { text: `🔍 *Searching Database for: ${sNum}...*` }, { quoted: m });

            try {
                const res = await axios.get(`https://api.impossible-world.xyz/api/data?phone=${sNum}`);
                if (!res.data.success || !res.data.records.length) {
                    return sock.sendMessage(from, { text: `❌ *No Data Found!*`, edit: lMsg.key });
                }
                let lns = res.data.records.map((r, i) => `👤 *REC ${i+1}*\nName: ${r.Name}\nCNIC: ${r.CNIC}\nMobile: ${r.Mobile}`).join('\n\n');
                sock.sendMessage(m.key.remoteJid, { text: `📂 *RESULTS FOUND*\n\n${lns}`, edit: lMsg.key });
            } catch { 
                sock.sendMessage(m.key.remoteJid, { text: `❌ *API Error or Timeout!*`, edit: lMsg.key }); 
            }
        }
    },

    sticker: {
        category: 'Tools',
        execute: async (sock, m, { downloadMedia, reply, from }) => {
            let q = m.message.extendedTextMessage?.contextInfo?.quotedMessage || m.message;
            let mime = (q.imageMessage || q.videoMessage)?.mimetype || "";
            if (!mime.startsWith('image') && !mime.startsWith('video')) return reply('⚠️ Reply to media.');

            await sock.sendMessage(from, { react: { text: '⏳', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Converting to Sticker...*' }, { quoted: m });

            try {
                const buff = await downloadMedia(q.imageMessage || q.videoMessage, mime.startsWith('image') ? 'image' : 'video');
                const iF = `${Date.now()}.${mime.startsWith('image') ? 'jpg' : 'mp4'}`, oF = `${Date.now()}.webp`;
                fs.writeFileSync(iF, buff);
                
                exec(`ffmpeg -i ${iF} -vcodec libwebp -filter:v fps=fps=15 -lossless 1 -loop 0 -preset default -an -vsync 0 -s 512:512 ${oF}`, async (err) => {
                    if (fs.existsSync(iF)) fs.unlinkSync(iF); // Cleanup input
                    if (!err) {
                        await sock.sendMessage(from, { sticker: fs.readFileSync(oF) }, { quoted: m });
                        await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });
                    } else {
                        await sock.sendMessage(from, { text: '❌ *Conversion Failed*', edit: waitMsg.key });
                    }
                    if (fs.existsSync(oF)) fs.unlinkSync(oF);
                });
            } catch (e) {
                await sock.sendMessage(from, { text: '❌ *Error!*', edit: waitMsg.key });
            }
        }
    },

    remini: {
        category: 'Tools',
        execute: async (sock, m, { downloadMedia, uploadToCatbox, reply, from }) => {
            let q = m.message.extendedTextMessage?.contextInfo?.quotedMessage || m.message;
            if (!(q.imageMessage || q.viewOnceMessage?.message?.imageMessage)) return reply('⚠️ Reply to image.');

            await sock.sendMessage(from, { react: { text: '🎨', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Enhancing Image (HD)...*' }, { quoted: m });

            try {
                const buff = await downloadMedia(q.imageMessage || q.viewOnceMessage?.message?.imageMessage, 'image');
                const url = await uploadToCatbox(buff);
                if (!url) return sock.sendMessage(from, { text: '❌ Upload failed.', edit: waitMsg.key });

                const res = await axios.get(`https://remini.mobilz.pw/enhance?url=${url}`);
                if (res.data.url) {
                    await sock.sendMessage(from, { image: { url: res.data.url }, caption: '✨ *Enhanced by AI*' }, { quoted: m });
                    await sock.sendMessage(from, { text: '✅ *Finished!*', edit: waitMsg.key });
                } else {
                    throw new Error("No URL");
                }
            } catch { 
                await sock.sendMessage(from, { text: '❌ API Error.', edit: waitMsg.key }); 
            }
        }
    },

    removebg: {
        category: 'Tools',
        execute: async (sock, m, { downloadMedia, uploadToCatbox, reply, from }) => {
            let q = m.message.extendedTextMessage?.contextInfo?.quotedMessage || m.message;
            if (!q.imageMessage) return reply('⚠️ Reply to image.');

            await sock.sendMessage(from, { react: { text: '✂️', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Removing Background...*' }, { quoted: m });

            try {
                const buff = await downloadMedia(q.imageMessage, 'image');
                const url = await uploadToCatbox(buff);
                if (!url) return sock.sendMessage(from, { text: '❌ Upload failed.', edit: waitMsg.key });
                
                const apiUrl = `https://bk9.fun/tools/removebg?url=${url}`; 
                
                await sock.sendMessage(from, { image: { url: apiUrl }, caption: '✂️ *Background Removed*' }, { quoted: m });
                await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });
            } catch (e) { 
                await sock.sendMessage(from, { text: '❌ API Error (Server Busy).', edit: waitMsg.key }); 
            }
        }
    },

    weather: {
        category: 'Tools',
        execute: async (sock, m, { text, reply, from }) => {
            if (!text) return reply('⚠️ City?');
            
            await sock.sendMessage(from, { react: { text: '🌦️', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: `⚙️ *Fetching Weather for ${text}...*` }, { quoted: m });

            try {
                const res = await axios.get(`https://wttr.in/${text}?format=%C+%t`);
                await sock.sendMessage(from, { text: `🌦️ *${text}:* ${res.data}`, edit: waitMsg.key });
            } catch { 
                await sock.sendMessage(from, { text: '❌ City not found.', edit: waitMsg.key }); 
            }
        }
    }
};