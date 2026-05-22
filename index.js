const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const MessageStore = require('./lib/messageStore');
const { MessageFilter } = require('./lib/filter');

const messageStore = new MessageStore(config);
const messageFilter = new MessageFilter();

const freshStart = process.argv.includes('--fresh');

if (freshStart) {
  const authDir = path.join(config.logging.authDir, config.whatsapp.sessionName);
  if (fs.existsSync(authDir)) {
    console.log('Clearing old auth state...');
    fs.rmSync(authDir, { recursive: true, force: true });
  }
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: config.whatsapp.sessionName,
    dataPath: config.logging.authDir,
  }),
  puppeteer: {
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
    ],
  },
  qrMaxRetries: 3,
  takeoverOnConflict: true,
});

client.on('qr', (qr) => {
  console.log('\n============================================');
  console.log('  SCAN THIS QR CODE WITH WHATSAPP');
  console.log('============================================');
  console.log('  Open WhatsApp on your phone');
  console.log('  Tap Menu (⋮) > Linked Devices > Link a Device');
  console.log('  Scan the QR code below:\n');
  qrcode.generate(qr, { small: false });
  console.log('\n  Waiting for scan...\n');
});

client.on('ready', () => {
  console.log('');
  console.log('============================================');
  console.log('  CONNECTED TO WHATSAPP');
  console.log('============================================');
  console.log(`  Messages logged to: ${config.logging.logDir}`);
  console.log('============================================');
  console.log('');
});

client.on('authenticated', () => {
  console.log('✓ Authenticated successfully');
});

client.on('auth_failure', (msg) => {
  console.error('✗ Authentication failure:', msg);
});

client.on('message', async (msg) => {
  try {
    if (!messageFilter.shouldLog(msg)) return;

    messageStore.writeMessage(msg);

    const sender = msg._data?.notifyName || msg.from?.split('@')[0] || 'Unknown';
    const chatName = msg.from?.split('@')[0] || 'Unknown';
    const content = msg.body?.slice(0, 80) || '(no text)';
    console.log(`[${chatName}] ${sender}: ${content}`);
  } catch (err) {
    console.error('[error] Failed to process message:', err.message);
  }
});

client.on('disconnected', (reason) => {
  console.log(`\n✗ Disconnected: ${reason}`);
  console.log(`  Reconnecting in ${config.whatsapp.reconnectDelay / 60000}min...\n`);
  setTimeout(() => client.initialize(), config.whatsapp.reconnectDelay);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  messageStore.close();
  client.destroy();
  process.exit(0);
});

console.log('WhatsApp Logger — AI Training Data Collector');
console.log('===========================================');
console.log('');

client.initialize();
