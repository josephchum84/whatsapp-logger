const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class MessageStore {
  constructor(config) {
    this.config = config.logging;
    this.encConfig = config.encryption;
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

  _drainStreams() {
    const streams = [];
    if (this.combinedStream) streams.push(this.combinedStream);
    for (const key of Object.keys(this.conversationStreams)) {
      streams.push(this.conversationStreams[key]);
    }
    return Promise.all(streams.map(s => new Promise((resolve, reject) => {
      s.on('finish', resolve);
      s.on('error', reject);
      s.end();
    })));
  }

  _encryptLine(plaintext) {
    if (!this.encConfig || !this.encConfig.enabled || !this.encConfig.key) return plaintext + '\n';
    const iv = crypto.randomBytes(this.encConfig.ivLength);
    const cipher = crypto.createCipheriv(this.encConfig.algorithm, this.encConfig.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64') + '\n';
  }

  _decryptLine(line) {
    if (!this.encConfig || !this.encConfig.enabled || !this.encConfig.key) return line;
    try {
      const buf = Buffer.from(line, 'base64');
      const iv = buf.subarray(0, this.encConfig.ivLength);
      const tag = buf.subarray(this.encConfig.ivLength, this.encConfig.ivLength + this.encConfig.tagLength);
      const encrypted = buf.subarray(this.encConfig.ivLength + this.encConfig.tagLength);
      const decipher = crypto.createDecipheriv(this.encConfig.algorithm, this.encConfig.key, iv);
      decipher.setAuthTag(tag);
      return decipher.update(encrypted) + decipher.final('utf-8');
    } catch {
      return null;
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

    const line = JSON.stringify(record);

    if (this.config.writeCombinedLog && this.combinedStream) {
      this.combinedStream.write(this._encryptLine(line));
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
      this.conversationStreams[chatKey].write(this._encryptLine(line));
    }
  }

  _readLines(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    const result = [];
    for (const line of lines) {
      let parsed = null;
      const decrypted = this._decryptLine(line);
      if (decrypted !== null) {
        try { parsed = JSON.parse(decrypted); } catch { /* try plaintext */ }
      }
      if (parsed === null) {
        try { parsed = JSON.parse(line); } catch { /* skip */ }
      }
      if (parsed !== null) result.push(parsed);
    }
    return result;
  }

  getAllMessagesForDate(dateStr) {
    const p = path.join(this.config.logDir, `messages-${dateStr}.ndjson`);
    return this._readLines(p);
  }

  getConversationsForDate(dateStr) {
    const dir = this.config.conversationsDir;
    if (!fs.existsSync(dir)) return {};
    const files = fs.readdirSync(dir).filter(f => f.endsWith(`-${dateStr}.ndjson`));
    const result = {};
    for (const file of files) {
      const chatKey = file.replace(`-${dateStr}.ndjson`, '');
      result[chatKey] = this._readLines(path.join(dir, file));
    }
    return result;
  }

  close() {
    this._closeStreams();
  }
}

module.exports = MessageStore;
