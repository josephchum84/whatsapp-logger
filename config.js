const path = require('path');

module.exports = {
  whatsapp: {
    sessionName: 'whatsapp-logger-session',
    markRead: false,
    reconnectDelay: 300000,
  },

  logging: {
    authDir: path.join(__dirname, 'data', 'auth'),
    logDir: path.join(__dirname, 'data', 'logs'),
    conversationsDir: path.join(__dirname, 'data', 'logs', 'conversations'),
    writeCombinedLog: true,
    writePerConversation: true,
    includeMetadata: true,
  },

  filter: {
    allowedChats: [],
    includeOwnMessages: true,
    minMessageLength: 0,
  },
};
