const axios = require('axios');

module.exports = {
    ig: {
        category: 'Downloaders',
        execute: async (sock, m, { args, reply, from }) => {
            if (!args[0]) return reply('⚠️ Please provide Instagram URL.');
            
            // 1. Reaction & Wait Message
            await sock.sendMessage(from, { react: { text: '📸', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Downloading from Instagram...*' }, { quoted: m });

            try {
                // Using a reliable public API
                const res = await axios.get(`https://api.tiklydown.eu.org/api/download?url=${args[0]}`);
                const data = res.data;

                if (data.video?.url) {
                    await sock.sendMessage(from, { video: { url: data.video.url }, caption: '✅ *Saved*' }, { quoted: m });
                } else if (data.images) {
                    for (let img of data.images) {
                        await sock.sendMessage(from, { image: { url: img.url } });
                    }
                } else {
                    throw new Error("No media found");
                }
                
                // Edit Wait Message on Success
                await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });

            } catch (e) {
                await sock.sendMessage(from, { text: '❌ *Error Fetching!* Check link or try again.', edit: waitMsg.key });
            }
        }
    },

    tiktok: {
        category: 'Downloaders',
        execute: async (sock, m, { args, reply, from }) => {
            if (!args[0]) return reply('⚠️ Please provide TikTok URL.');

            // 1. Reaction & Wait Message
            await sock.sendMessage(from, { react: { text: '🎵', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Downloading TikTok (No Watermark)...*' }, { quoted: m });

            try {
                const res = await axios.get(`https://www.tikwm.com/api/?url=${args[0]}`);
                if (res.data.data?.play) {
                    await sock.sendMessage(from, { video: { url: res.data.data.play }, caption: `✅ *${res.data.data.title || 'Saved'}*` }, { quoted: m });
                    await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });
                } else {
                    throw new Error("No video");
                }
            } catch {
                await sock.sendMessage(from, { text: '❌ *Error!* Private video or invalid link.', edit: waitMsg.key });
            }
        }
    },

    // --- 🆕 FACEBOOK DOWNLOADER ---
    fb: {
        category: 'Downloaders',
        execute: async (sock, m, { args, reply, from }) => {
            if (!args[0]) return reply('⚠️ Please provide Facebook URL.');

            await sock.sendMessage(from, { react: { text: '📘', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Fetching Facebook Video...*' }, { quoted: m });

            try {
                // Free API for FB
                const res = await axios.get(`https://bk9.fun/downloader/facebook?url=${args[0]}`);
                if (res.data.status && res.data.BK9?.HD) {
                    await sock.sendMessage(from, { video: { url: res.data.BK9.HD }, caption: '✅ *Facebook HD*' }, { quoted: m });
                    await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });
                } else if (res.data.BK9?.SD) {
                    await sock.sendMessage(from, { video: { url: res.data.BK9.SD }, caption: '✅ *Facebook SD*' }, { quoted: m });
                    await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });
                } else {
                    throw new Error("No video found");
                }
            } catch {
                await sock.sendMessage(from, { text: '❌ *Error!* Video is private or API busy.', edit: waitMsg.key });
            }
        }
    },

    // --- 🆕 PINTEREST DOWNLOADER ---
    pin: {
        category: 'Downloaders',
        execute: async (sock, m, { args, reply, from }) => {
            if (!args[0]) return reply('⚠️ Pinterest Link?');

            await sock.sendMessage(from, { react: { text: '📌', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Searching Pinterest...*' }, { quoted: m });

            try {
                const res = await axios.get(`https://bk9.fun/downloader/pinterest?url=${args[0]}`);
                if (res.data.status && res.data.BK9?.url) {
                    const mediaUrl = res.data.BK9.url;
                    if (mediaUrl.endsWith('.mp4')) {
                        await sock.sendMessage(from, { video: { url: mediaUrl }, caption: '✅ *Saved*' }, { quoted: m });
                    } else {
                        await sock.sendMessage(from, { image: { url: mediaUrl }, caption: '✅ *Saved*' }, { quoted: m });
                    }
                    await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });
                } else {
                    throw new Error("No media");
                }
            } catch {
                await sock.sendMessage(from, { text: '❌ *Error!*', edit: waitMsg.key });
            }
        }
    },

    // --- 🆕 YOUTUBE MP3 (Audio) ---
    ytmp3: {
        category: 'Downloaders',
        execute: async (sock, m, { args, reply, from }) => {
            if (!args[0]) return reply('⚠️ YouTube Link?');

            await sock.sendMessage(from, { react: { text: '🎧', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Converting YouTube to Audio...*' }, { quoted: m });

            try {
                const res = await axios.get(`https://bk9.fun/downloader/youtube?url=${args[0]}`);
                if (res.data.status && res.data.BK9?.mp3) {
                    await sock.sendMessage(from, { 
                        document: { url: res.data.BK9.mp3 }, 
                        mimetype: 'audio/mpeg', 
                        fileName: `${res.data.BK9.title || 'Audio'}.mp3` 
                    }, { quoted: m });
                    await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });
                } else {
                    throw new Error("Failed");
                }
            } catch {
                await sock.sendMessage(from, { text: '❌ *Error!* Try a shorter video.', edit: waitMsg.key });
            }
        }
    },

    // --- 🆕 YOUTUBE MP4 (Video) ---
    ytmp4: {
        category: 'Downloaders',
        execute: async (sock, m, { args, reply, from }) => {
            if (!args[0]) return reply('⚠️ YouTube Link?');

            await sock.sendMessage(from, { react: { text: '📺', key: m.key } });
            let waitMsg = await sock.sendMessage(from, { text: '⚙️ *Downloading YouTube Video...*' }, { quoted: m });

            try {
                const res = await axios.get(`https://bk9.fun/downloader/youtube?url=${args[0]}`);
                if (res.data.status && res.data.BK9?.mp4) {
                    await sock.sendMessage(from, { video: { url: res.data.BK9.mp4 }, caption: res.data.BK9.title || 'YouTube' }, { quoted: m });
                    await sock.sendMessage(from, { text: '✅ *Done!*', edit: waitMsg.key });
                } else {
                    throw new Error("Failed");
                }
            } catch {
                await sock.sendMessage(from, { text: '❌ *Error!* File too large or API busy.', edit: waitMsg.key });
            }
        }
    }
};