const config = require('../config');

class MessageFilter {
  constructor() {
    this.config = config.filter;
  }

  shouldLog(msg) {
    const { key, message } = msg;
    if (!key?.remoteJid) return false;
    if (!message) return false;

    if (this.config.allowedChats.length > 0) {
      if (!this.config.allowedChats.includes(key.remoteJid)) {
        return false;
      }
    }

    if (!this.config.includeOwnMessages && msg.key.fromMe) {
      return false;
    }

    const content = extractText(message);
    if (content && this.config.minMessageLength > 0 && content.length < this.config.minMessageLength) {
      return false;
    }

    return true;
  }
}

function extractText(message) {
  if (!message) return '';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  return '';
}

module.exports = { MessageFilter, extractText };
