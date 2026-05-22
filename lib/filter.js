const config = require('../config');

class MessageFilter {
  constructor() {
    this.config = config.filter;
  }

  shouldLog(msg) {
    if (!msg) return false;
    if (!msg.from) return false;
    if (msg.type === 'e2e_notification') return false;
    if (msg.type === 'notification') return false;
    if (msg.type === 'notification_template') return false;
    if (msg.type === 'ciphertext') return false;

    if (this.config.allowedChats.length > 0) {
      if (!this.config.allowedChats.includes(msg.from)) {
        return false;
      }
    }

    if (!this.config.includeOwnMessages && msg.fromMe) {
      return false;
    }

    if (this.config.minMessageLength > 0 && msg.body && msg.body.length < this.config.minMessageLength) {
      return false;
    }

    return true;
  }
}

module.exports = { MessageFilter };
