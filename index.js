const TelegramBot = require("node-telegram-bot-api");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");
const path = require("path");
const NodeCache = require("node-cache");
const express = require("express");

const settings = require("./settings");
const { connectDB } = require("./db");
const User = require("./models/User");
const Session = require("./models/Session");
const activityHandler = require("./activitys");

// ================= CRASH GUARD =================
process.on("uncaughtException", err => console.error("❌ Crash:", err));
process.on("unhandledRejection", err => console.error("❌ Rejection:", err));

// ================= TELEGRAM =================
const bot = new TelegramBot(settings.telegramBotToken, { polling: true });

// ================= WEB =================
const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // pic.png + index.html

// ================= MEMORY =================
const ACTIVE_SESSIONS = new Map();
const CONNECTION_STATUS = new Map();
const USER_STATE = new Map();
const msgRetryCounterCache = new NodeCache();

// ================= HELPERS =================
const isOwner = (id) => settings.ownerIds.includes(id);

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
        `🤖 *${settings.botName}*`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } }
    );
});

// ================= CALLBACK =================
bot.on("callback_query", async (q) => {
    try { await bot.answerCallbackQuery(q.id); } catch {}
    const chatId = q.message.chat.id;
    const data = q.data;

    if (data === "connect") {
        USER_STATE.set(chatId, "WAIT_NUMBER");
        return bot.sendMessage(chatId, "📱 WhatsApp number with country code:");
    }

    if (data === "manage") {
        const user = await User.findOne({ telegramId: chatId });
        if (!user || !user.numbers.length)
            return bot.sendMessage(chatId, "❌ No connected numbers.");

        return bot.sendMessage(chatId, "📂 Your Numbers:", {
            reply_markup: {
                inline_keyboard: user.numbers.map(n => [
                    { text: `${CONNECTION_STATUS.get(n) === "open" ? "🟢" : "🔴"} ${n}`, callback_data: `num_${n}` }
                ])
            }
        });
    }

    if (data.startsWith("num_")) {
        const num = data.split("_")[1];
        return bot.sendMessage(chatId, `⚙️ +${num}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "▶️ Start", callback_data: `start_${num}` }],
                    [{ text: "🔄 Renew", callback_data: `renew_${num}` }],
                    [{ text: "🛑 Stop", callback_data: `stop_${num}` }]
                ]
            }
        });
    }

    if (data.startsWith("start_"))
        startWhatsApp(data.split("_")[1], chatId, false);

    if (data.startsWith("renew_"))
        startWhatsApp(data.split("_")[1], chatId, true);

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
    if (num.length < 10)
        return bot.sendMessage(msg.chat.id, "❌ Invalid number.");

    await User.updateOne(
        { telegramId: msg.chat.id },
        { $addToSet: { numbers: num } },
        { upsert: true }
    );

    startWhatsApp(num, msg.chat.id, true);
});

// ================= WHATSAPP (FIXED PAIRING) =================
async function startWhatsApp(number, tgId, forceNew) {
    const sessionDir = path.join(settings.sessionDir, number);

    if (forceNew && fs.existsSync(sessionDir))
        fs.rmSync(sessionDir, { recursive: true, force: true });

    fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(
                state.keys,
                pino({ level: "silent" })
            )
        },
        msgRetryCounterCache
    });

    ACTIVE_SESSIONS.set(number, sock);
    CONNECTION_STATUS.set(number, "connecting");
    sock.ev.on("creds.update", saveCreds);

    // ✅ SAFE PAIRING CODE (NO FORMAT CHANGE)
    if (!state.creds.registered && settings.usePairingCode) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(number);
                if (tgId) {
                    bot.sendMessage(
                        tgId,
                        `🔢 *Pairing Code*\n\n\`${code}\`\n\nWhatsApp → Link device`,
                        { parse_mode: "Markdown" }
                    );
                }
            } catch (e) {
                console.error("Pairing error:", e);
            }
        }, 2000);
    }

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "open") {
            CONNECTION_STATUS.set(number, "open");
            await Session.updateOne(
                { number },
                { number, connectedAt: new Date(), status: "open" },
                { upsert: true }
            );
            tgId && bot.sendMessage(tgId, `✅ +${number} Connected`);
        }

        if (connection === "close") {
            CONNECTION_STATUS.set(number, "closed");
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                await Session.deleteOne({ number });
            }
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        if (m.type !== "notify") return;
        for (const msg of m.messages) {
            if (msg.message)
                await activityHandler(sock, msg, number);
        }
    });
}

// ================= WEB API =================
app.post("/api/pair", async (req, res) => {
    const { deviceId, number } = req.body;
    if (!number || !deviceId) return res.json({ error: true });

    await User.updateOne(
        { deviceId },
        { $addToSet: { numbers: number } },
        { upsert: true }
    );

    startWhatsApp(number, null, true);
    res.json({ ok: true });
});

app.get("/api/numbers/:deviceId", async (req, res) => {
    const user = await User.findOne({ deviceId: req.params.deviceId });
    res.json(user?.numbers || []);
});

// ================= START =================
(async () => {
    await connectDB();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log("🌐 Web running on", PORT));

    console.log("🚀 Bot Started");
})();