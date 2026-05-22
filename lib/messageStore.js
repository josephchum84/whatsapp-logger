const fs = require('fs');
const path = require('path');
const { format } = require('util');

class MessageStore {
  constructor(config) {
    this.config = config.logging;
    this.combinedStream = null;
    this.conversationStreams = {};

    this._ensureDirs();
    this._initStreams();
  }

  _ensureDirs() {
    for (const dir of [this.config.logDir, this.config.conversationsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  _initStreams() {
    if (this.config.writeCombinedLog) {
      const combinedPath = path.join(this.config.logDir, 'messages.ndjson');
      this.combinedStream = fs.createWriteStream(combinedPath, { flags: 'a' });
    }
  }

  _getChatKey(msg) {
    // Use conversation ID based on JID
    const jid = msg.key.remoteJid;
    // Sanitize for filename
    return jid.replace(/[^a-zA-Z0-9@._-]/g, '_');
  }

  _getChatName(msg) {
    const jid = msg.key.remoteJid || 'unknown';
    if (jid.endsWith('@g.us')) {
      return `group:${jid}`;
    }
    if (jid.endsWith('@s.whatsapp.net')) {
      return `contact:${jid.replace('@s.whatsapp.net', '')}`;
    }
    return jid;
  }

  _extractMessageContent(msg) {
    const { message } = msg;
    if (!message) return null;

    // Extract text from various message types
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    if (message.documentMessage?.caption) return message.documentMessage.caption;

    // Message types that indicate non-text content
    if (message.imageMessage) return '[IMAGE]';
    if (message.videoMessage) return '[VIDEO]';
    if (message.audioMessage) return '[AUDIO]';
    if (message.stickerMessage) return '[STICKER]';
    if (message.documentMessage) return '[DOCUMENT]';
    if (message.locationMessage) return '[LOCATION]';
    if (message.contactMessage) return '[CONTACT]';

    return '[UNSUPPORTED]';
  }

  _buildMessageRecord(msg) {
    const key = msg.key;
    const sender = key.participant || key.remoteJid;
    const timestamp = msg.messageTimestamp
      ? new Date(msg.messageTimestamp * 1000).toISOString()
      : new Date().toISOString();

    const record = {
      id: key.id,
      chatId: key.remoteJid,
      chatName: this._getChatName(msg),
      sender,
      senderName: msg.pushName || null,
      timestamp,
      type: msg.message
        ? Object.keys(msg.message).find(k => k.endsWith('Message') || k === 'conversation') || 'unknown'
        : 'unknown',
      content: this._extractMessageContent(msg),
    };

    if (record.content === null) return null;
    return record;
  }

  writeMessage(msg) {
    const record = this._buildMessageRecord(msg);
    if (!record) return;

    // Write to combined log
    if (this.config.writeCombinedLog && this.combinedStream) {
      this.combinedStream.write(JSON.stringify(record) + '\n');
    }

    // Write to per-conversation log
    if (this.config.writePerConversation) {
      const chatKey = this._getChatKey(msg);
      const convPath = path.join(this.config.conversationsDir, `${chatKey}.ndjson`);

      if (!this.conversationStreams[chatKey]) {
        this.conversationStreams[chatKey] = fs.createWriteStream(convPath, { flags: 'a' });
      }
      this.conversationStreams[chatKey].write(JSON.stringify(record) + '\n');
    }
  }

  close() {
    if (this.combinedStream) {
      this.combinedStream.end();
    }
    for (const stream of Object.values(this.conversationStreams)) {
      stream.end();
    }
  }
}

module.exports = MessageStore;
