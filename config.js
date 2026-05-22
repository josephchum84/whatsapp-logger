const path = require('path');

module.exports = {
  whatsapp: {
    // Session name for auth state storage
    sessionName: 'whatsapp-logger-session',
    // Mark messages as read (false for pure logging)
    markRead: false,
    // Reconnect delay on disconnect (ms)
    reconnectDelay: 5000,
  },

  logging: {
    // Directory for auth state
    authDir: path.join(__dirname, 'data', 'auth'),
    // Directory for message logs
    logDir: path.join(__dirname, 'data', 'logs'),
    // Directory for per-conversation logs
    conversationsDir: path.join(__dirname, 'data', 'logs', 'conversations'),
    // Write a combined messages.ndjson file (one JSON per line)
    writeCombinedLog: true,
    // Write per-conversation files
    writePerConversation: true,
    // Save message metadata (sender info, timestamps, etc.)
    includeMetadata: true,
  },

  filter: {
    // Only log messages from these JIDs (empty = log all)
    // Format: 'number@s.whatsapp.net' for private chats
    //         'id@g.us' for groups
    allowedChats: [],
    // Log messages from own number too (outgoing)
    includeOwnMessages: true,
    // Exclude messages shorter than this length (0 = include all)
    minMessageLength: 0,
  },
};
