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
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys");

const settings = require("./settings");
const { connectDB } = require("./db");
const User = require("./models/User");
const Session = require("./models/Session");
const activityHandler = require("./activitys");

// ================= CRASH GUARD =================
process.on("uncaughtException", err => console.error("❌ Crash:", err));
process.on("unhandledRejection", err => console.error("❌ Rejection:", err));

// ================= MEMORY & STATE =================
const ACTIVE_SESSIONS = new Map();
const CONNECTION_STATUS = new Map();
const USER_STATE = new Map();
const msgRetryCounterCache = new NodeCache();
const isOwner = (id) => settings.ownerIds.includes(id);

// ================= EXPRESS & WEBHOOK SETUP =================
const app = express();
app.use(express.json()); // Webhook ڈیٹا کے لیے لازمی ہے

const PORT = process.env.PORT || 8080;
const URL = process.env.PUBLIC_URL || `https://${process.env.RAILWAY_STATIC_URL}`;

// ویب ہک سیٹ اپ
const bot = new TelegramBot(settings.telegramBotToken);
if (URL) {
    bot.setWebHook(`${URL}/bot${settings.telegramBotToken}`)
        .then(() => console.log(`🎯 Webhook Active: ${URL}`))
        .catch(e => console.log("❌ Webhook Error:", e.message));
}

// ٹیلیگرام اپڈیٹ کا راستہ
app.post(`/bot${settings.telegramBotToken}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// ویب سائٹ اور اسٹیٹس روٹ
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/status", (req, res) => res.send({ status: "Running", time: new Date() }));

// سرور کا آغاز (0.0.0.0 کے ساتھ)
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Server active on Port ${PORT}`);
});

// ================= TELEGRAM BOT LOGIC =================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const keyboard = [
        [{ text: "➕ Connect New", callback_data: "connect" }],
        [{ text: "📂 Manage Bots", callback_data: "manage" }]
    ];
    if (isOwner(chatId)) keyboard.push([{ text: "👑 Owner Panel", callback_data: "owner_panel" }]);

    bot.sendMessage(chatId, `🤖 *Welcome to ${settings.botName}*\nStatus: Online 🟢`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard }
    });
});

bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    if (q.data === "connect") {
        USER_STATE.set(chatId, "WAIT_NUMBER");
        bot.sendMessage(chatId, "📱 اپنا واٹس ایپ نمبر انٹرنیشنل فارمیٹ میں بھیجیں (مثال: 923001234567):");
    }
    // ... Manage اور Owner کی لاجک یہاں شامل کی جا سکتی ہے
});

bot.on("message", async (msg) => {
    if (USER_STATE.get(msg.chat.id) === "WAIT_NUMBER" && msg.text) {
        const num = msg.text.replace(/\D/g, "");
        if (num.length < 10) return bot.sendMessage(msg.chat.id, "❌ نمبر غلط ہے!");
        
        USER_STATE.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, `⏳ پیرنگ کوڈ جنریٹ ہو رہا ہے، براہ کرم انتظار کریں...`);
        startWhatsApp(num, msg.chat.id, true);
    }
});

// ================= WHATSAPP LOGIC (FIXED) =================
async function startWhatsApp(number, tgId, forceNew) {
    const sessionDir = path.join(settings.sessionDir, number);
    if (forceNew && fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

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
        browser: ["Ubuntu", "Chrome", "20.0.04"], // لازمی ہے
        msgRetryCounterCache
    });

    // پیرنگ کوڈ کی درخواست
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(number);
                bot.sendMessage(tgId, `🔢 *آپ کا پیرنگ کوڈ:*\n\n\`${code}\`\n\nاسے اپنے واٹس ایپ کے "Link Device" سیکشن میں جا کر لگائیں۔`, { parse_mode: "Markdown" });
            } catch (err) {
                bot.sendMessage(tgId, "❌ کوڈ حاصل کرنے میں مسئلہ ہوا۔ دوبارہ کوشش کریں۔");
            }
        }, 6000); // 6 سیکنڈ کا وقفہ تاکہ سوکٹ ریڈی ہو جائے
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") {
            CONNECTION_STATUS.set(number, "open");
            bot.sendMessage(tgId, `✅ واٹس ایپ +${number} کنیکٹ ہو گیا ہے!`);
        }
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) startWhatsApp(number, tgId, false);
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        if (m.type !== "notify") return;
        for (const msg of m.messages) {
            if (!msg.message) continue;
            await activityHandler(sock, msg, number);
        }
    });

    ACTIVE_SESSIONS.set(number, sock);
}

// ================= INITIALIZE =================
(async () => {
    await connectDB();
    console.log("🚀 System Fully Loaded");
})();
