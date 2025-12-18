module.exports = {
    // بوت کی بنیادی معلومات
    ownerName: "Nothing Is Impossible 🜲",
    ownerNumber: "923027665767", // آپ کا واٹس ایپ نمبر
    botName: "Group Guard",
    
    // ٹیلیگرام بوٹ
    telegramBotToken: '8189731973:AAH-u426pLdUiVj89y_fO8btw3GZ-zwHjaU',
    
    // Pairing code سیٹنگز
    usePairingCode: true, // true = pairing code, false = QR code
    
    // Required channels for Telegram bot
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
    
    // Session directory
    sessionDir: './sessions',
    
    // Connection settings
    connectionTimeout: 60000,
    keepAliveInterval: 25000,
    
    // Bot behavior
    autoReconnect: false, // false = manual reconnect
    maxRetryAttempts: 3,
    
    // Logging
    debugMode: true,
    logLevel: 'info'
};