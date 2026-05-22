const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const KEY_PATH = path.join(__dirname, 'data', 'encryption-key.bin');

function loadOrGenerateKey() {
  const envKey = process.env.WHATSAPP_LOGGER_KEY;
  if (envKey) {
    if (!/^[0-9a-f]{64}$/i.test(envKey)) {
      console.error('WHATSAPP_LOGGER_KEY must be a 64-char hex string (32 bytes)');
      process.exit(1);
    }
    return Buffer.from(envKey, 'hex');
  }
  const dir = path.dirname(KEY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(KEY_PATH)) {
    return fs.readFileSync(KEY_PATH);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, key);
  console.log('Generated encryption key -> data/encryption-key.bin');
  return key;
}

module.exports = {
  whatsapp: {
    sessionName: 'whatsapp-logger-session',
    markRead: false,
    reconnectDelay: 300000,
    maxReconnectAttempts: 10,
  },

  logging: {
    authDir: path.join(__dirname, 'data', 'auth'),
    logDir: path.join(__dirname, 'data', 'logs'),
    conversationsDir: path.join(__dirname, 'data', 'logs', 'conversations'),
    writeCombinedLog: true,
    writePerConversation: true,
    includeMetadata: true,
  },

  encryption: {
    enabled: true,
    key: loadOrGenerateKey(),
    algorithm: 'aes-256-gcm',
    ivLength: 12,
    tagLength: 16,
  },

  filter: {
    allowedChats: [],
    includeOwnMessages: true,
    minMessageLength: 0,
  },
};
