module.exports = {
    // ================= BASIC INFO =================
    ownerName: "Nothing Is Impossible 🜲",
    ownerNumber: "923027665767",
    botName: "Group Guard",

    // ================= TELEGRAM =================
    telegramBotToken: "8189731973:AAH-u426pLdUiVj89y_fO8btw3GZ-zwHjaU",

    // 👑 OWNER IDS (Telegram numeric IDs)
    ownerIds: [8167904992, 7134046678],

    // ================= PAIRING =================
    usePairingCode: true, // true = pairing code only

    // ================= REQUIRED CHANNELS =================
    requiredChannels: [
        {
            name: "Impossible - World",
            link: "https://t.me/only_possible_worlds0"
        },
        {
            name: "Kami Broken",
            link: "https://t.me/Kami_Broken5"
        }
    ],

    // ================= DATABASE =================
    mongoUri: "mongodb://mongo:AEvrikOWlrmJCQrDTQgfGtqLlwhwLuAA@crossover.proxy.rlwy.net:29609",

    // ================= SESSIONS =================
    sessionDir: "./sessions",

    // ================= CONNECTION =================
    connectionTimeout: 60000,
    keepAliveInterval: 25000,
    autoReconnect: false,

    // ================= LOGGING =================
    debugMode: true,
    logLevel: "info"
};