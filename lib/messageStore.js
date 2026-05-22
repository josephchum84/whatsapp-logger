const fs = require('fs');
const path = require('path');

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
    return msg.from ? msg.from.replace(/[^a-zA-Z0-9@._-]/g, '_') : 'unknown';
  }

  _getChatName(msg) {
    const jid = msg.from || 'unknown';
    if (jid.endsWith('@g.us')) {
      return `group:${jid}`;
    }
    return `contact:${jid.replace('@c.us', '').replace('@s.whatsapp.net', '')}`;
  }

  _buildMessageRecord(msg) {
    const timestamp = msg.timestamp
      ? new Date(msg.timestamp * 1000).toISOString()
      : new Date().toISOString();

    const record = {
      id: msg.id?._serialized || msg.id || null,
      chatId: msg.from || null,
      chatName: this._getChatName(msg),
      sender: msg.author || msg.from || null,
      senderName: msg._data?.notifyName || msg._data?.pushName || null,
      timestamp,
      type: msg.type || 'text',
      content: msg.body || null,
    };

    return record;
  }

  writeMessage(msg) {
    const record = this._buildMessageRecord(msg);
    if (!record || !record.content) return;

    if (this.config.writeCombinedLog && this.combinedStream) {
      this.combinedStream.write(JSON.stringify(record) + '\n');
    }

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
    if (this.combinedStream) this.combinedStream.end();
    for (const stream of Object.values(this.conversationStreams)) {
      stream.end();
    }
  }
}

module.exports = MessageStore;
