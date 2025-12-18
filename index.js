const TelegramBot = require('node-telegram-bot-api');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require('fs');
const path = require('path');
const NodeCache = require("node-cache"); 
const settings = require('./settings');
const activityHandler = require('./activitys');

// ================= CRASH GUARD =================
process.on('uncaughtException', (err) => console.error('❌ Crash:', err.message));
process.on('unhandledRejection', (reason) => console.error('❌ Rejection:', reason));

const bot = new TelegramBot(settings.telegramBotToken, { polling: true });
const ACTIVE_SESSIONS = new Map(); 
const USER_INPUT_STATE = new Map(); 
const msgRetryCounterCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); 
const notificationCooldown = new Set();
const CONNECTION_STATUS = new Map();

const DB_FILE = './telegram_users.json';
const OWNER_DB_FILE = './owner.json';

const loadDB = () => { 
    try { 
        return JSON.parse(fs.readFileSync(DB_FILE)); 
    } catch { 
        return {}; 
    } 
};

const saveDB = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

const updateOwnerDB = (jid, num) => { 
    try { 
        fs.writeFileSync(OWNER_DB_FILE, JSON.stringify({[jid]: num})); 
    } catch(e) {}
};

const getUserNumbers = (id) => { 
    const db = loadDB(); 
    return db[id] || []; 
};

const addNumberToUser = (tgId, waNumber) => {
    let db = loadDB();
    if (!db[tgId]) db[tgId] = [];
    if (!db[tgId].includes(waNumber)) db[tgId].push(waNumber);
    saveDB(db);
};

const removeNumberFromUser = (tgId, waNumber) => {
    let db = loadDB();
    if (db[tgId]) { 
        db[tgId] = db[tgId].filter(n => n !== waNumber); 
        saveDB(db); 
    }
};

async function restoreAllSessions() {
    console.log('🔄 Restoring sessions...');
    const db = loadDB();
    const allNumbers = new Set();
    Object.values(db).forEach(nums => nums.forEach(n => allNumbers.add(n)));
    
    for (const number of allNumbers) {
        const sessionPath = path.join(settings.sessionDir, number);
        if (fs.existsSync(sessionPath)) {
            try { 
                await startWhatsAppBot(number, null, false); 
                await delay(2000); 
            } catch (err) {
                console.log(`❌ Failed to restore ${number}:`, err.message);
            }
        }
    }
    console.log('✅ Sessions restored');
}

// Keep alive - NO reconnection
function startKeepAlive() {
    setInterval(() => {
        ACTIVE_SESSIONS.forEach(async (sock, number) => { 
            try {
                if (CONNECTION_STATUS.get(number) === 'open') {
                    await sock.sendPresenceUpdate('available');
                }
            } catch (err) {
                console.log(`Keep alive error for ${number}:`, err.message);
            }
        });
    }, 300000); // 5 minutes
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    let text = "👋 **WhatsApp Bot Manager**\nManage multiple accounts easily.";
    const keyboard = [];
    settings.requiredChannels.forEach(ch => keyboard.push([{ text: `📢 Join ${ch.name}`, url: ch.link }]));
    keyboard.push([{ text: "✅ VERIFY / ENTER", callback_data: "verify_join" }]);
    bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const msgId = query.message.message_id;

    if (data === "verify_join") showMainMenu(chatId, msgId);
    else if (data === "main_connect") {
        USER_INPUT_STATE.set(chatId, "WAITING_FOR_NUMBER");
        bot.sendMessage(chatId, "📱 Enter WhatsApp Number (with country code, e.g., 923001234567):");
    }
    else if (data === "main_manage") showManageMenu(chatId, msgId);
    else if (data.startsWith("manage_num_")) showNumberOptions(chatId, msgId, data.split("manage_num_")[1]);
    else if (data === "back_main") showMainMenu(chatId, msgId);
    else if (data.startsWith("act_")) {
        const parts = data.split("_");
        const action = parts[1], number = parts[2];
        
        if (action === "stop") {
            if (ACTIVE_SESSIONS.has(number)) { 
                try { 
                    ACTIVE_SESSIONS.get(number).end(); 
                } catch {} 
                ACTIVE_SESSIONS.delete(number); 
                CONNECTION_STATUS.delete(number);
                bot.sendMessage(chatId, `🛑 Stopped ${number}`); 
            }
        } else if (action === "start") {
            bot.sendMessage(chatId, `⏳ Starting ${number}...`);
            await startWhatsAppBot(number, chatId, false); 
        } else if (action === "renew") {
            bot.sendMessage(chatId, `⚠️ Renewing ${number}...`);
            await startWhatsAppBot(number, chatId, true); 
        } else if (action === "delete") {
            if (ACTIVE_SESSIONS.has(number)) { 
                try { 
                    ACTIVE_SESSIONS.get(number).end(); 
                } catch {} 
                ACTIVE_SESSIONS.delete(number); 
                CONNECTION_STATUS.delete(number);
            }
            const sessionDir = path.join(settings.sessionDir, number);
            if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
            removeNumberFromUser(chatId, number);
            bot.sendMessage(chatId, `🗑️ Deleted ${number}`);
            setTimeout(() => showManageMenu(chatId, msgId), 1000);
        }
    }
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (USER_INPUT_STATE.get(chatId) === "WAITING_FOR_NUMBER") {
        if (!text) return;
        let number = text.replace(/[^0-9]/g, '');
        if (number.length < 10) return bot.sendMessage(chatId, "❌ Invalid number format.");
        USER_INPUT_STATE.delete(chatId);
        addNumberToUser(chatId, number); 
        bot.sendMessage(chatId, `⏳ Connecting +${number}...`);
        startWhatsAppBot(number, chatId, true); 
    }
});

function showMainMenu(chatId, msgId) {
    const kb = { 
        inline_keyboard: [
            [{ text: "➕ Connect New", callback_data: "main_connect" }], 
            [{ text: "📂 Manage Bots", callback_data: "main_manage" }]
        ] 
    };
    if (msgId) {
        bot.editMessageText("🤖 **WhatsApp Bot Manager**", { 
            chat_id: chatId, 
            message_id: msgId, 
            reply_markup: kb, 
            parse_mode: "Markdown" 
        }).catch(()=>{});
    } else {
        bot.sendMessage(chatId, "🤖 **WhatsApp Bot Manager**", { 
            reply_markup: kb, 
            parse_mode: "Markdown" 
        });
    }
}

function showManageMenu(chatId, msgId) {
    const nums = getUserNumbers(chatId);
    if (nums.length === 0) {
        return bot.editMessageText("❌ No connected numbers.", { 
            chat_id: chatId, 
            message_id: msgId, 
            reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_main" }]] } 
        });
    }
    
    const kb = nums.map(n => {
        const status = CONNECTION_STATUS.get(n) === 'open' ? "🟢" : "🔴";
        return [{ text: `${status} ${n}`, callback_data: `manage_num_${n}` }];
    });
    kb.push([{ text: "🔙 Back", callback_data: "back_main" }]);
    
    bot.editMessageText("📂 **Select Number:**", { 
        chat_id: chatId, 
        message_id: msgId, 
        reply_markup: { inline_keyboard: kb }, 
        parse_mode: "Markdown" 
    });
}

function showNumberOptions(chatId, msgId, number) {
    const kb = { 
        inline_keyboard: [
            [{ text: "▶️ Start", callback_data: `act_start_${number}` }, { text: "🛑 Stop", callback_data: `act_stop_${number}` }], 
            [{ text: "🔄 Renew", callback_data: `act_renew_${number}` }, { text: "🗑️ Delete", callback_data: `act_delete_${number}` }], 
            [{ text: "🔙 Back", callback_data: "main_manage" }]
        ] 
    };
    bot.editMessageText(`⚙️ **Settings:** +${number}`, { 
        chat_id: chatId, 
        message_id: msgId, 
        reply_markup: kb, 
        parse_mode: "Markdown" 
    });
}

async function startWhatsAppBot(targetNumber, telegramChatId, forceNew = false) {
    try {
        console.log(`🚀 Starting WhatsApp bot for: ${targetNumber}`);
        
        const sessionDir = path.join(settings.sessionDir, targetNumber);
        
        // اگر forceNew ہے تو پرانی سیشن ڈیلیٹ کریں
        if (forceNew && fs.existsSync(sessionDir)) {
            console.log(`🗑️ Removing old session for ${targetNumber}`);
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        
        // سیشن ڈائریکٹری بنائیں اگر نہ ہو
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
            console.log(`📁 Created session directory for ${targetNumber}`);
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();
        
        console.log(`🔧 Creating socket for ${targetNumber}...`);
        
        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: { 
                creds: state.creds, 
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })) 
            },
            syncFullHistory: false,
            browser: ['Chrome (Linux)', '', ''],
            msgRetryCounterCache,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: undefined,
            keepAliveIntervalMs: 25000,
            emitOwnEvents: false,
            fireInitQueries: true,
            generateHighQualityLinkPreview: false,
            patchMessageBeforeSending: (message) => {
                const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
                if (requiresPatch) {
                    message = { 
                        viewOnceMessage: { 
                            message: { 
                                messageContextInfo: { 
                                    deviceListMetadataVersion: 2, 
                                    deviceListMetadata: {} 
                                }, 
                                ...message 
                            } 
                        } 
                    };
                }
                return message;
            },
            getMessage: async () => undefined
        });

        ACTIVE_SESSIONS.set(targetNumber, sock);
        CONNECTION_STATUS.set(targetNumber, 'connecting');
        
        console.log(`⏳ Waiting for connection: ${targetNumber}`);

        // پیئرنگ کوڈ کے لیے فلگ
        let pendingPairingCodeRequest = false;
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log(`📱 QR code received for ${targetNumber}`);
            }
            
            if (connection === 'open') {
                console.log(`✅ ${targetNumber} connected successfully!`);
                CONNECTION_STATUS.set(targetNumber, 'open');
                
                // اونر ڈیٹا بیس اپڈیٹ کریں
                if (sock.user && sock.user.id) {
                    updateOwnerDB(sock.user.id, targetNumber);
                }
                
                // کنیکشن کے بعد پیئرنگ کوڈ جنریٹ کریں اگر ضرورت ہو
                if ((forceNew || !state.creds.registered) && telegramChatId) {
                    try {
                        console.log(`🔢 Generating pairing code for ${targetNumber}...`);
                        await delay(5000); // 5 سیکنڈ کا انتظار
                        
                        let code = await sock.requestPairingCode(targetNumber);
                        console.log(`📱 Pairing code generated for ${targetNumber}: ${code}`);
                        
                        // کوڈ کو فارمیٹ کریں (XXXX-XXXX)
                        if (code && code.length === 8) {
                            code = code.substring(0, 4) + '-' + code.substring(4);
                        }
                        
                        bot.sendMessage(telegramChatId, 
                            `🔢 *Pairing Code for +${targetNumber}:*\n\n` +
                            `\`${code}\`\n\n` +
                            `📝 *How to use:*\n` +
                            `1. Open WhatsApp on your phone\n` +
                            `2. Go to Settings → Linked Devices\n` +
                            `3. Tap on "Link a Device"\n` +
                            `4. Enter this code\n\n` +
                            `⏱️ *Code expires in 20 seconds*`,
                            { parse_mode: "Markdown" }
                        );
                        
                        pendingPairingCodeRequest = false;
                    } catch (err) { 
                        console.error(`❌ Pairing code error for ${targetNumber}:`, err.message);
                        
                        // Alternative: QR code
                        if (telegramChatId) {
                            bot.sendMessage(telegramChatId, 
                                `❌ *Failed to generate pairing code for +${targetNumber}*\n\n` +
                                `Please try:\n` +
                                `1. Use QR code method instead\n` +
                                `2. Check if number is correct\n` +
                                `3. Try "Renew" option`,
                                { parse_mode: "Markdown" }
                            ); 
                        }
                    }
                }
                
                // کنکشن نوٹیفیکیشن
                if(telegramChatId && !notificationCooldown.has(targetNumber)) {
                    bot.sendMessage(telegramChatId, 
                        `✅ *+${targetNumber} Connected Successfully!*\n\n` +
                        `🆔 User ID: ${sock.user?.id || 'N/A'}\n` +
                        `📛 Name: ${sock.user?.name || 'Not set'}`,
                        { parse_mode: "Markdown" }
                    );
                    notificationCooldown.add(targetNumber);
                    setTimeout(() => notificationCooldown.delete(targetNumber), 60000);
                }
            }
            
            if (connection === 'close') {
                console.log(`⚠️ ${targetNumber} disconnected`);
                CONNECTION_STATUS.set(targetNumber, 'closed');
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message;
                
                console.log(`🔍 Disconnect details for ${targetNumber}:`, { statusCode, errorMessage });
                
                // اگر لوگ آؤٹ ہوا ہے
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log(`🚫 ${targetNumber} logged out from WhatsApp`);
                    ACTIVE_SESSIONS.delete(targetNumber);
                    CONNECTION_STATUS.delete(targetNumber);
                    
                    // سیشن ڈیلیٹ کریں
                    if (fs.existsSync(sessionDir)) {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                        console.log(`🗑️ Session deleted for ${targetNumber}`);
                    }
                    
                    // ٹیلیگرام پر نوٹیفائی کریں
                    if(telegramChatId) {
                        bot.sendMessage(telegramChatId, 
                            `❌ *+${targetNumber} Logged Out*\n\n` +
                            `WhatsApp has logged out this session.\n` +
                            `Use "Renew" option to reconnect.`,
                            { parse_mode: "Markdown" }
                        );
                    }
                    return;
                }
                
                // دوسرے کنکشن مسائل
                ACTIVE_SESSIONS.delete(targetNumber);
                console.log(`🔧 ${targetNumber} - Manual restart required`);
                
                if(telegramChatId) {
                    let errorMsg = `⚠️ *+${targetNumber} Disconnected*\n\n`;
                    
                    if (statusCode === 515) {
                        errorMsg += `Reason: Connection timeout\n`;
                    } else if (statusCode === 408) {
                        errorMsg += `Reason: Request timeout\n`;
                    } else if (errorMessage?.includes("replaced")) {
                        errorMsg += `Reason: Session replaced by another device\n`;
                    } else {
                        errorMsg += `Reason: Unknown (Code: ${statusCode})\n`;
                    }
                    
                    errorMsg += `\nClick "Start" button to reconnect.`;
                    
                    bot.sendMessage(telegramChatId, errorMsg, { parse_mode: "Markdown" });
                }
            }
            
            // کنیکشن ہو رہا ہے
            if (connection === 'connecting') {
                console.log(`🔄 ${targetNumber} connecting...`);
                CONNECTION_STATUS.set(targetNumber, 'connecting');
            }
        });

        // میسج ہینڈلر
        sock.ev.on('messages.upsert', async (chatUpdate) => {
            if (chatUpdate.type !== 'notify') return;
            
            // ایک وقت میں ایک میسج پروسیس کریں
            for (const m of chatUpdate.messages) {
                if (!m.message) continue;
                
                try {
                    // ایکٹیویٹی ہینڈلر کال کریں
                    await activityHandler(sock, m, targetNumber);
                } catch (e) {
                    console.error(`Handler error for ${targetNumber}:`, e.message);
                }
            }
        });

        // کنیکشن ایررز
        sock.ev.on('connection.phone.code.request', () => {
            console.log(`📱 Phone code requested for ${targetNumber}`);
        });
        
        sock.ev.on('connection.phone.code.submit', () => {
            console.log(`✅ Phone code submitted for ${targetNumber}`);
        });

    } catch (criticalErr) { 
        console.error(`❌ Critical error for ${targetNumber}:`, criticalErr.message); 
        CONNECTION_STATUS.set(targetNumber, 'error');
        
        if (telegramChatId) {
            bot.sendMessage(telegramChatId, 
                `❌ *Failed to start +${targetNumber}*\n\n` +
                `Error: ${criticalErr.message}\n\n` +
                `Possible solutions:\n` +
                `1. Check internet connection\n` +
                `2. Try "Renew" option\n` +
                `3. Verify phone number format`,
                { parse_mode: "Markdown" }
            );
        }
    }
}

// بوٹ شروع کریں
(async () => {
    console.log('🚀 WhatsApp Multi-Bot Manager Starting...');
    console.log('📁 Session directory:', settings.sessionDir);
    console.log('👤 Owner:', settings.ownerName);
    
    try {
        await restoreAllSessions();
        startKeepAlive();
        console.log('✅ Bot started successfully!');
        console.log('📱 Use /start in Telegram to begin');
    } catch (err) {
        console.error('❌ Failed to start bot:', err.message);
        process.exit(1);
    }
})();

// سگنل ہینڈلنگ
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    
    // تمام سیشنز بند کریں
    ACTIVE_SESSIONS.forEach((sock, number) => {
        try {
            sock.end();
            console.log(`✅ Closed session for ${number}`);
        } catch (e) {
            console.log(`❌ Error closing ${number}:`, e.message);
        }
    });
    
    setTimeout(() => {
        console.log('👋 Bot stopped');
        process.exit(0);
    }, 2000);
});