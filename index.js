const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const MessageStore = require('./lib/messageStore');
const { MessageFilter } = require('./lib/filter');

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino/file',
    options: { destination: path.join(config.logging.logDir, 'whatsapp.log') },
  },
});

const messageStore = new MessageStore(config);
const messageFilter = new MessageFilter();

// Parse --phone argument for pairing code mode
const phoneArg = process.argv.find(a => a.startsWith('--phone='));
let phoneNumber = phoneArg ? phoneArg.split('=')[1] : null;

if (phoneNumber === 'NUMBER' || phoneNumber === 'PHONE_NUMBER') {
  console.error('ERROR: Replace NUMBER with your actual phone number.');
  console.error('  Correct: node index.js --phone=+60123357911');
  console.error('  Or:      npm run pair -- --phone=+60123357911\n');
  process.exit(1);
}

if (phoneNumber) {
  console.log('Using phone pairing mode. Make sure to:');
  console.log('  Open WhatsApp > Linked Devices > Link with phone number');
  console.log('');
}

async function connect() {
  const authDir = path.join(config.logging.authDir, config.whatsapp.sessionName);

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  // Check if we already have a saved session
  const isLoggedIn = state.creds?.me?.id ? true : false;

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    emitOwnEvents: false,
    connectTimeoutMs: 30000,
    keepAliveIntervalMs: 25000,
    defaultQueryTimeoutMs: 60000,
    browser: ['WhatsApp Logger', 'Chrome', '1.0.0'],
  });

  // Handle QR code
  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      if (phoneNumber) {
        return;
      }

      console.log('\n============================================');
      console.log('  SCAN THIS QR CODE WITH WHATSAPP');
      console.log('============================================');
      console.log('  Open WhatsApp on your phone');
      console.log('  Tap Menu (⋮) > Linked Devices > Link a Device');
      console.log('  Scan the QR code below:\n');
      qrcode.generate(qr, { small: false });
      console.log('\n  Waiting for scan...\n');
    }

    if (connection === 'open') {
      console.log('');
      console.log('============================================');
      console.log('  CONNECTED TO WHATSAPP');
      console.log('============================================');
      console.log(`  Logged in as: ${sock.user?.name || 'Unknown'}`);
      console.log(`  Phone: ${sock.user?.id || 'Unknown'}`);
      console.log(`  Messages logged to: ${config.logging.logDir}`);
      console.log('============================================');
      console.log('');
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      if (!shouldReconnect) {
        console.log('\n✗ Logged out or session expired.');
        console.log('  To re-authenticate, delete the data/auth folder and run again.\n');
        process.exit(1);
      }

      const reason = lastDisconnect?.error?.output?.statusCode;
      const reasonName = Object.keys(DisconnectReason).find(k => DisconnectReason[k] === reason) || 'Unknown';
      console.log(`\n✗ Disconnected (${reasonName}). Reconnecting in ${config.whatsapp.reconnectDelay / 1000}s...\n`);
      setTimeout(connect, config.whatsapp.reconnectDelay);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // If using pairing mode, request pairing code once socket is ready
  if (phoneNumber) {
    // Wait for the socket to be connected before requesting pairing code
    const checkAndRequestPairing = async () => {
      try {
        // Clean the phone number
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (cleanNumber.length < 10 || cleanNumber.length > 15) {
          console.error(`Invalid phone number: ${phoneNumber}. Must be 10-15 digits.`);
          return;
        }

        console.log(`Requesting pairing code for ${cleanNumber}...`);
        console.log('  (Make sure WhatsApp is open on your phone)\n');

        const code = await sock.requestPairingCode(cleanNumber);

        console.log('============================================');
        console.log('  PAIRING CODE');
        console.log('============================================');
        console.log(`  Code: ${code}`);
        console.log('');
        console.log('  Open WhatsApp on your phone');
        console.log('  Tap Menu (⋮) > Linked Devices > Link with phone number');
        console.log('  Enter this code (without spaces)');
        console.log('');
        console.log('  Waiting for pairing to complete...');
        console.log('============================================');
        console.log('');
      } catch (err) {
        console.error('Failed to request pairing code:', err.message);
        console.log('  Falling back to QR code mode...');
      }
    };

    // Call after a short delay to let the socket initialize
    setTimeout(checkAndRequestPairing, 1000);
  }

  // Listen for messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      try {
        if (!messageFilter.shouldLog(msg)) continue;

        messageStore.writeMessage(msg);

        const sender = msg.pushName || msg.key.participant?.split('@')[0] || 'Unknown';
        const chatName = msg.key.remoteJid?.split('@')[0] || 'Unknown';
        const content = extractPreview(msg.message);
        console.log(`[${chatName}] ${sender}: ${content}`);

        if (config.whatsapp.markRead && msg.key) {
          await sock.readMessages([msg.key]);
        }
      } catch (err) {
        console.error('[error] Failed to process message:', err.message);
      }
    }
  });

  sock.ev.on('presence.update', () => {});
}

function extractPreview(message) {
  if (!message) return '(no content)';
  if (message.conversation) return message.conversation.slice(0, 80);
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text.slice(0, 80);
  if (message.imageMessage?.caption) return `📷 ${message.imageMessage.caption.slice(0, 60)}`;
  if (message.videoMessage?.caption) return `🎥 ${message.videoMessage.caption.slice(0, 60)}`;
  if (message.imageMessage) return '[📷 Image]';
  if (message.videoMessage) return '[🎥 Video]';
  if (message.audioMessage) return '[🎵 Audio]';
  if (message.stickerMessage) return '[📎 Sticker]';
  if (message.documentMessage) return '[📄 Document]';
  return '[Unsupported]';
}

// Create data directories
for (const dir of [config.logging.logDir, config.logging.conversationsDir, config.logging.authDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Banner
console.log('WhatsApp Logger — AI Training Data Collector');
console.log('===========================================');
if (phoneNumber) {
  console.log(`Mode: Phone pairing (${phoneNumber})`);
} else {
  console.log('Mode: QR code scan');
}
console.log('');

// SIGINT handler (registered once outside connect to avoid duplicates on reconnect)
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  messageStore.close();
  process.exit(0);
});

connect().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
