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

async function connect() {
  const authDir = path.join(config.logging.authDir, config.whatsapp.sessionName);

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

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
      console.log('\nScan this QR code with WhatsApp on your phone:');
      console.log('  Open WhatsApp > Linked Devices > Link a Device\n');
      qrcode.generate(qr, { small: true });
      console.log('\n');
    }

    if (connection === 'open') {
      console.log('✓ Connected to WhatsApp!');
      console.log(`  Logged in as: ${sock.user?.name || sock.user?.id || 'Unknown'}`);
      console.log(`  Messages will be saved to: ${config.logging.logDir}`);
      console.log('');
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      if (!shouldReconnect) {
        console.log('✗ Logged out. Delete the auth folder and re-run to re-authenticate.');
        process.exit(1);
      }

      console.log(`✗ Disconnected. Reconnecting in ${config.whatsapp.reconnectDelay / 1000}s...`);
      setTimeout(connect, config.whatsapp.reconnectDelay);
    }
  });

  // Save creds on update
  sock.ev.on('creds.update', saveCreds);

  // Listen for messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      try {
        if (!messageFilter.shouldLog(msg)) continue;

        messageStore.writeMessage(msg);

        // Log to console
        const sender = msg.pushName || msg.key.participant?.split('@')[0] || 'Unknown';
        const chatName = msg.key.remoteJid?.split('@')[0] || 'Unknown';
        const content = extractPreview(msg.message);
        console.log(`[${chatName}] ${sender}: ${content}`);

        // Optionally mark as read
        if (config.whatsapp.markRead && msg.key) {
          await sock.readMessages([msg.key]);
        }
      } catch (err) {
        console.error('[error] Failed to process message:', err.message);
      }
    }
  });

  // Handle presence updates
  sock.ev.on('presence.update', () => {});

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    messageStore.close();
    process.exit(0);
  });
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

console.log('WhatsApp Logger — AI Training Data Collector');
console.log('===========================================');
console.log('');

connect().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
