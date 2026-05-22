const fs = require('fs');
const path = require('path');

class MessageStore {
  constructor(config) {
    this.config = config.logging;
    this.combinedStream = null;
    this.conversationStreams = {};
    this.currentDate = null;

    this._ensureDirs();
  }

  _ensureDirs() {
    for (const dir of [this.config.logDir, this.config.conversationsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  _dateStr() {
    return new Date().toISOString().slice(0, 10);
  }

  _rotateIfNeeded() {
    const today = this._dateStr();
    if (today !== this.currentDate) {
      this._closeStreams();
      this.currentDate = today;
      this._openStreams();
    }
  }

  _openStreams() {
    if (this.config.writeCombinedLog) {
      const p = path.join(this.config.logDir, `messages-${this.currentDate}.ndjson`);
      this.combinedStream = fs.createWriteStream(p, { flags: 'a' });
    }
    // Conversation streams are lazily created in writeMessage
  }

  _closeStreams() {
    if (this.combinedStream) {
      this.combinedStream.end();
      this.combinedStream = null;
    }
    for (const key of Object.keys(this.conversationStreams)) {
      this.conversationStreams[key].end();
    }
    this.conversationStreams = {};
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

  _buildRecord(msg) {
    const timestamp = msg.timestamp
      ? new Date(msg.timestamp * 1000).toISOString()
      : new Date().toISOString();

    return {
      id: msg.id?._serialized || msg.id || null,
      chatId: msg.from || null,
      chatName: this._getChatName(msg),
      sender: msg.author || msg.from || null,
      senderName: msg._data?.notifyName || msg._data?.pushName || null,
      timestamp,
      type: msg.type || 'text',
      content: msg.body || null,
    };
  }

  writeMessage(msg) {
    this._rotateIfNeeded();

    const record = this._buildRecord(msg);
    if (!record || !record.content) return;

    if (this.config.writeCombinedLog && this.combinedStream) {
      this.combinedStream.write(JSON.stringify(record) + '\n');
    }

    if (this.config.writePerConversation) {
      const chatKey = this._getChatKey(msg);
      const convPath = path.join(
        this.config.conversationsDir,
        `${chatKey}-${this.currentDate}.ndjson`
      );

      if (!this.conversationStreams[chatKey]) {
        this.conversationStreams[chatKey] = fs.createWriteStream(convPath, { flags: 'a' });
      }
      this.conversationStreams[chatKey].write(JSON.stringify(record) + '\n');
    }
  }

  getAllMessagesForDate(dateStr) {
    const p = path.join(this.config.logDir, `messages-${dateStr}.ndjson`);
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean);
    return lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  }

  getConversationsForDate(dateStr) {
    const dir = this.config.conversationsDir;
    if (!fs.existsSync(dir)) return {};
    const files = fs.readdirSync(dir).filter(f => f.endsWith(`-${dateStr}.ndjson`));
    const result = {};
    for (const file of files) {
      const chatKey = file.replace(`-${dateStr}.ndjson`, '');
      const lines = fs.readFileSync(path.join(dir, file), 'utf-8').split('\n').filter(Boolean);
      result[chatKey] = lines.map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    }
    return result;
  }

  close() {
    this._closeStreams();
  }
}

module.exports = MessageStore;
