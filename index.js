const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const MessageStore = require('./lib/messageStore');
const { MessageFilter } = require('./lib/filter');
const ConversationAnalyzer = require('./lib/analyzer');

const messageStore = new MessageStore(config);
const messageFilter = new MessageFilter();
const analyzer = new ConversationAnalyzer(config);

const freshStart = process.argv.includes('--fresh');
const runAnalysisOnly = process.argv.includes('--analyze');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// --analyze mode: run analysis on existing data and exit
if (runAnalysisOnly) {
  const dateArg = process.argv.find(a => a.startsWith('--date='));
  let targetDate;
  if (dateArg) {
    targetDate = dateArg.split('=')[1];
    if (!DATE_REGEX.test(targetDate)) {
      console.error('Invalid date format. Use --date=YYYY-MM-DD');
      process.exit(1);
    }
  } else {
    targetDate = new Date().toISOString().slice(0, 10);
  }
  console.log(`Analyzing conversations for ${targetDate}...`);
  const conversations = messageStore.getConversationsForDate(targetDate);
  const total = Object.values(conversations).flat().length;
  console.log(`Found ${total} messages across ${Object.keys(conversations).length} conversations.`);
  const result = analyzer.analyze(conversations, targetDate);
  console.log('\nAnalysis complete. Written to:');
  console.log(`  Profile: data/logs/analysis/agent-profile.json`);
  console.log(`  This run: data/logs/analysis/analysis-history.json`);
  console.log('\n=== AGENT PROFILE SUMMARY ===');
  console.log(JSON.stringify({
    identity: { name: result.identity.name, role: result.identity.role, traits: result.identity.traits.slice(0, 5) },
    style: { tone: result.conversationalStyle.tone, formality: result.conversationalStyle.formality, language: result.conversationalStyle.language },
    knowledge: { domains: result.knowledgeBase.domains, topTopics: Object.keys(result.knowledgeBase.topics).slice(0, 10), skills: result.knowledgeBase.skills.slice(0, 5) },
    taskLogic: { patterns: result.taskLogic.patterns.length, workflows: result.taskLogic.workflows.length },
    summary: result.summary,
  }, null, 2));
  process.exit(0);
}

// Fresh start
if (freshStart) {
  const authDir = path.join(config.logging.authDir, config.whatsapp.sessionName);
  if (fs.existsSync(authDir)) {
    console.log('Clearing old auth state...');
    fs.rmSync(authDir, { recursive: true, force: true });
  }
}

// Schedule daily analysis at 6pm
function scheduleDailyAnalysis() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(18, 0, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  const delayMs = target - now;

  console.log(`Next analysis scheduled at ${target.toLocaleString()}`);
  setTimeout(async () => {
    const today = new Date().toISOString().slice(0, 10);
    console.log(`\n[${today}] Running daily analysis...`);
    try {
      const conversations = messageStore.getConversationsForDate(today);
      const result = analyzer.analyze(conversations, today);
      console.log(`Analysis complete. ${result.summary.totalMessages} messages processed.`);
      console.log(`  Profile: data/logs/analysis/agent-profile.json`);
    } catch (err) {
      console.error('Analysis failed:', err.message);
    }
    // Schedule next day
    scheduleDailyAnalysis();
  }, delayMs);
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
      '--disable-dev-shm-usage',
      '--no-first-run',
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
  console.log('');
  scheduleDailyAnalysis();
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

let reconnectAttempts = 0;

client.on('disconnected', (reason) => {
  console.log(`\n✗ Disconnected: ${reason}`);
  const maxAttempts = config.whatsapp.maxReconnectAttempts;
  if (reconnectAttempts >= maxAttempts) {
    console.error(`  Max reconnect attempts (${maxAttempts}) reached. Exiting.`);
    process.exit(1);
  }
  reconnectAttempts++;
  console.log(`  Reconnect attempt ${reconnectAttempts}/${maxAttempts} in ${config.whatsapp.reconnectDelay / 60000}min...\n`);
  setTimeout(() => client.initialize(), config.whatsapp.reconnectDelay);
});

client.on('authenticated', () => {
  reconnectAttempts = 0;
});

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  console.log('  Draining pending writes...');
  await messageStore._drainStreams().catch(() => {});
  client.destroy();
});

console.log('WhatsApp Logger — AI Training Data Collector');
console.log('===========================================');
console.log('Features:');
console.log('  • Daily log rotation (data/logs/messages-YYYY-MM-DD.ndjson)');
console.log('  • Daily analysis at 6pm (Identity, Style, Knowledge, Task Logic)');
console.log('  • Manual: node index.js --analyze');
console.log('  • Manual with date: node index.js --analyze --date=2026-05-22');
console.log('');

client.initialize();
