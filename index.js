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
    delay // delay helper for pairing code
} = require("@whiskeysockets/baileys");

const settings = require("./settings");
const { connectDB } = require("./db");
const User = require("./models/User");
const Session = require("./models/Session");
const activityHandler = require("./activitys");

// ================= EXPRESS SETUP =================
const app = express();
app.use(express.json()); // Webhook کے لیے ضروری ہے
const PORT = process.env.PORT || 8080;

// ================= TELEGRAM BOT (WEBHOOK MODE) =================
// پولنگ بند کر دی ہے تاکہ پورٹ کا مسئلہ نہ ہو
const bot = new TelegramBot(settings.telegramBotToken);
const URL = process.env.PUBLIC_URL || `https://${process.env.RAILWAY_STATIC_URL}`;

// ویب ہک سیٹ اپ
bot.setWebHook(`${URL}/bot${settings.telegramBotToken}`);

// ٹیلیگرام اپڈیٹس کے لیے روٹ
app.post(`/bot${settings.telegramBotToken}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// ویب سائٹ کے لیے روٹس
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// سرور اسٹارٹ کریں
app.listen(PORT, () => {
    console.log(`🌐 Server is running on port ${PORT}`);
    console.log(`🤖 Bot Webhook set to: ${URL}/bot${settings.telegramBotToken}`);
});

// ================= MEMORY & HELPERS =================
const ACTIVE_SESSIONS = new Map();
const CONNECTION_STATUS = new Map();
const USER_STATE = new Map();
const msgRetryCounterCache = new NodeCache();
const isOwner = (id) => settings.ownerIds.includes(id);

// ================= TELEGRAM LOGIC =================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const keyboard = [
        [{ text: "➕ Connect New (Pairing Code)", callback_data: "connect" }],
        [{ text: "📂 Manage Bots", callback_data: "manage" }]
    ];
    if (isOwner(chatId)) keyboard.push([{ text: "👑 Owner Panel", callback_data: "owner_panel" }]);

    bot.sendMessage(chatId, `🤖 *${settings.botName}* is Online!\n\nSelect an option:`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard }
    });
});

bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    if (data === "connect") {
        USER_STATE.set(chatId, "WAIT_NUMBER");
        return bot.sendMessage(chatId, "📱 Please send your WhatsApp number with Country Code (e.g., 923001234567):");
    }
    // ... باقی مینیج اور اونر پینل کی لاجک وہی رہے گی ...
});

bot.on("message", async (msg) => {
    if (USER_STATE.get(msg.chat.id) !== "WAIT_NUMBER" || !msg.text) return;
    const num = msg.text.replace(/\D/g, "");
    if (num.length < 10) return bot.sendMessage(msg.chat.id, "❌ Invalid number format.");
    
    USER_STATE.delete(msg.chat.id);
    await User.updateOne({ telegramId: msg.chat.id }, { $addToSet: { numbers: num } }, { upsert: true });
    
    bot.sendMessage(msg.chat.id, `⏳ Requesting Pairing Code for +${num}...`);
    startWhatsApp(num, msg.chat.id, true);
});

// ================= WHATSAPP LOGIC (FIXED PAIRING) =================
async function startWhatsApp(number, tgId, forceNew) {
    const sessionDir = path.join(settings.sessionDir, number);
    if (forceNew && fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
    fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        },
        msgRetryCounterCache,
        browser: ["Chrome (Linux)", "", ""] // پیرنگ کوڈ کے لیے براؤزر سیٹ کرنا ضروری ہے
    });

    // 🔥 PAIRING CODE FIX: یہ تب ہی چلے گا اگر اکاؤنٹ پہلے سے لنک نہ ہو
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                await delay(3000); // سوکٹ کے اسٹیبل ہونے کا انتظار
                const code = await sock.requestPairingCode(number);
                bot.sendMessage(tgId, `🔢 *Your Pairing Code:*\n\n\`${code}\``, { parse_mode: "Markdown" });
            } catch (err) {
                console.error("Pairing Error:", err);
                bot.sendMessage(tgId, "❌ Failed to generate pairing code. Please try again.");
            }
        }, 5000); // 5 سیکنڈ کا ڈیفالٹ انتظار
    }

    ACTIVE_SESSIONS.set(number, sock);
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") {
            CONNECTION_STATUS.set(number, "open");
            tgId && bot.sendMessage(tgId, `✅ +${number} Successfully Connected!`);
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
}

// ================= START =================
(async () => {
    await connectDB();
    console.log("🚀 Database Connected & System Initialized");
})();
