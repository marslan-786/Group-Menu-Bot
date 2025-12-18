// ========================= INDEX.JS =========================
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const path = require("path");
const fs = require("fs");
const NodeCache = require("node-cache");
const pino = require("pino");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");

const settings = require("./settings");
const { connectDB } = require("./db");
const User = require("./models/User");
const Session = require("./models/Session");
const activityHandler = require("./activitys");

// ================= CRASH GUARD =================
process.on("uncaughtException", err => console.error("❌ Crash:", err));
process.on("unhandledRejection", err => console.error("❌ Rejection:", err));

// ================= MEMORY =================
const ACTIVE_SESSIONS = new Map();
const CONNECTION_STATUS = new Map();
const USER_STATE = new Map();
const msgRetryCounterCache = new NodeCache();

// ================= HELPERS =================
const isOwner = (id) => settings.ownerIds.includes(id);

// ================= TELEGRAM =================
// Use webhook to avoid multiple polling conflicts
const bot = new TelegramBot(settings.telegramBotToken);
if (!process.env.WEBHOOK_DONE) {
    bot.setWebHook(`https://${process.env.PROJECT_DOMAIN || 'localhost'}:${process.env.PORT || 3000}/bot${settings.telegramBotToken}`);
    process.env.WEBHOOK_DONE = true;
}

// ================= EXPRESS =================
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Root route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start Express server
app.listen(PORT, () => console.log(`🌐 Web running on ${PORT}`));

// ================= TELEGRAM START =================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    const keyboard = [
        [{ text: "➕ Connect New", callback_data: "connect" }],
        [{ text: "📂 Manage Bots", callback_data: "manage" }]
    ];

    if (isOwner(chatId)) {
        keyboard.push([{ text: "👑 Owner Panel", callback_data: "owner_panel" }]);
    }

    bot.sendMessage(
        chatId,
        `🤖 *${settings.botName}*\n\nWelcome!`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } }
    );
});

// ================= CALLBACK =================
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    // ---------- USER ----------
    if (data === "connect") {
        USER_STATE.set(chatId, "WAIT_NUMBER");
        return bot.sendMessage(chatId, "📱 WhatsApp number with country code:");
    }

    if (data === "manage") {
        const user = await User.findOne({ telegramId: chatId });
        if (!user || !user.numbers.length)
            return bot.sendMessage(chatId, "❌ No connected numbers.");

        return bot.sendMessage(
            chatId,
            "📂 Your Numbers:",
            {
                reply_markup: {
                    inline_keyboard: user.numbers.map(n => [
                        { text: `${CONNECTION_STATUS.get(n) === "open" ? "🟢" : "🔴"} ${n}`, callback_data: `num_${n}` }
                    ])
                }
            }
        );
    }

    if (data.startsWith("num_")) {
        const num = data.split("_")[1];
        return bot.sendMessage(
            chatId,
            `⚙️ +${num}`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "▶️ Start", callback_data: `start_${num}` }],
                        [{ text: "🔄 Renew", callback_data: `renew_${num}` }],
                        [{ text: "🛑 Stop", callback_data: `stop_${num}` }]
                    ]
                }
            }
        );
    }

    // ---------- OWNER PANEL ----------
    if (data === "owner_panel" && isOwner(chatId)) {
        const users = await User.find();
        return bot.sendMessage(
            chatId,
            "👑 *Owner Panel*\n\nSelect User:",
            {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: users.map(u => [
                        { text: `👤 ${u.telegramId}`, callback_data: `owner_user_${u.telegramId}` }
                    ])
                }
            }
        );
    }

    if (data.startsWith("owner_user_") && isOwner(chatId)) {
        const uid = Number(data.split("_")[2]);
        const user = await User.findOne({ telegramId: uid });
        if (!user) return;

        const tgUser = await bot.getChat(uid).catch(() => ({}));

        let text =
            `👤 *User Details*\n\n` +
            `🆔 ID: ${uid}\n` +
            `👤 Name: ${tgUser.first_name || "N/A"}\n` +
            `🔗 Username: ${tgUser.username ? "@" + tgUser.username : "N/A"}\n\n` +
            `📱 *Connected Numbers:*`;

        const kb = user.numbers.map(n => [{ text: n, callback_data: "noop" }]);

        bot.sendMessage(chatId, text, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: kb }
        });
    }

    // ---------- ACTIONS ----------
    if (data.startsWith("start_")) startWhatsApp(data.split("_")[1], chatId, false);
    if (data.startsWith("renew_")) startWhatsApp(data.split("_")[1], chatId, true);

    if (data.startsWith("stop_")) {
        const n = data.split("_")[1];
        ACTIVE_SESSIONS.get(n)?.end();
        ACTIVE_SESSIONS.delete(n);
        CONNECTION_STATUS.set(n, "closed");
        bot.sendMessage(chatId, `🛑 Stopped ${n}`);
    }
});

// ================= NUMBER INPUT =================
bot.on("message", async (msg) => {
    if (USER_STATE.get(msg.chat.id) !== "WAIT_NUMBER") return;
    USER_STATE.delete(msg.chat.id);

    const num = msg.text.replace(/\D/g, "");
    if (num.length < 10) return bot.sendMessage(msg.chat.id, "❌ Invalid number.");

    await User.updateOne(
        { telegramId: msg.chat.id },
        { $addToSet: { numbers: num } },
        { upsert: true }
    );

    startWhatsApp(num, msg.chat.id, true);
});

// ================= WHATSAPP =================
async function startWhatsApp(number, tgId, forceNew) {
    const sessionDir = path.join(settings.sessionDir, number);
    if (forceNew && fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
    fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        },
        msgRetryCounterCache
    });

    ACTIVE_SESSIONS.set(number, sock);
    CONNECTION_STATUS.set(number, "connecting");
    sock.ev.on("creds.update", saveCreds);

    // 🔥 QR-based pairing code
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && tgId) {
            // Send QR code to Telegram
            bot.sendMessage(tgId, `📲 *WhatsApp QR Code* (scan in WhatsApp):\n\`${qr}\``, { parse_mode: "Markdown" });
        }

        if (connection === "open") {
            CONNECTION_STATUS.set(number, "open");
            await Session.updateOne(
                { number },
                { registered: true, lastStatus: "open" },
                { upsert: true }
            );
            tgId && bot.sendMessage(tgId, `✅ +${number} Connected`);
        }

        if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            CONNECTION_STATUS.set(number, "closed");

            if (code === DisconnectReason.loggedOut) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                await Session.deleteOne({ number });
            }
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        if (m.type !== "notify") return;
        for (const msg of m.messages) {
            if (!msg.message) continue;
            await activityHandler(sock, msg, number);
        }
    });
}

// ================= START =================
(async () => {
    await connectDB();
    console.log("🚀 Bot Started");
})();