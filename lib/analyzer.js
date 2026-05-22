const fs = require('fs');
const path = require('path');

class ConversationAnalyzer {
  constructor(config) {
    this.analysisDir = path.join(config.logging.logDir, 'analysis');
    this.profilePath = path.join(this.analysisDir, 'agent-profile.json');
    this.historyPath = path.join(this.analysisDir, 'analysis-history.json');
    if (!fs.existsSync(this.analysisDir)) {
      fs.mkdirSync(this.analysisDir, { recursive: true });
    }
  }

  analyze(conversations, today) {
    const profile = this._loadProfile();

    const todayAnalysis = {
      date: today,
      timestamp: new Date().toISOString(),
      identity: this._analyzeIdentity(conversations, profile),
      conversationalStyle: this._analyzeStyle(conversations, profile),
      knowledgeBase: this._analyzeKnowledge(conversations, profile),
      taskLogic: this._analyzeTaskLogic(conversations, profile),
      summary: {
        totalMessages: 0,
        uniqueContacts: 0,
        topChats: [],
      },
    };

    // Aggregate stats
    let allMsgs = [];
    for (const [chat, msgs] of Object.entries(conversations)) {
      allMsgs = allMsgs.concat(msgs);
    }
    const userMsgs = allMsgs.filter(m => !m.sender?.includes('@g.us') && !m.chatId?.includes('@g.us'));
    const ownMsgs = allMsgs.filter(m => m.senderName === null || m.sender === m.chatId);

    todayAnalysis.summary.totalMessages = allMsgs.length;
    todayAnalysis.summary.userMessages = userMsgs.length;
    todayAnalysis.summary.ownMessages = ownMsgs.length;
    todayAnalysis.summary.uniqueContacts = Object.keys(conversations).length;

    // Merge into cumulative profile
    this._mergeProfile(profile, todayAnalysis);
    this._saveProfile(profile);
    this._saveAnalysis(todayAnalysis);

    return todayAnalysis;
  }

  _loadProfile() {
    if (fs.existsSync(this.profilePath)) {
      try {
        return JSON.parse(fs.readFileSync(this.profilePath, 'utf-8'));
      } catch { /* fall through */ }
    }
    return {
      identity: { name: null, role: null, traits: [], statements: [], firstSeen: new Date().toISOString().slice(0, 10) },
      conversationalStyle: { tone: 'neutral', formality: 'neutral', commonPhrases: [], avgResponseLength: 0, emojiUsage: 0, language: 'unknown' },
      knowledgeBase: { topics: {}, skills: [], links: [], facts: [], domains: [] },
      taskLogic: { patterns: [], workflows: [], questionFrequency: 0, avgResponseTime: 0, decisionIndicators: [] },
      lastUpdated: null,
    };
  }

  _saveProfile(profile) {
    profile.lastUpdated = new Date().toISOString();
    fs.writeFileSync(this.profilePath, JSON.stringify(profile, null, 2));
  }

  _saveAnalysis(analysis) {
    const history = fs.existsSync(this.historyPath)
      ? JSON.parse(fs.readFileSync(this.historyPath, 'utf-8'))
      : [];
    history.push({
      date: analysis.date,
      timestamp: analysis.timestamp,
      summary: analysis.summary,
    });
    // Keep last 90 days
    if (history.length > 90) history.splice(0, history.length - 90);
    fs.writeFileSync(this.historyPath, JSON.stringify(history, null, 2));
  }

  _mergeProfile(profile, daily) {
    this._mergeIdentity(profile.identity, daily.identity);
    this._mergeStyle(profile.conversationalStyle, daily.conversationalStyle);
    this._mergeKnowledge(profile.knowledgeBase, daily.knowledgeBase);
    this._mergeTaskLogic(profile.taskLogic, daily.taskLogic);
  }

  _mergeIdentity(target, source) {
    if (source.name && !target.name) target.name = source.name;
    if (source.role && !target.role) target.role = source.role;
    target.traits = this._mergeTop(target.traits, source.traits, 30);
    target.statements = this._mergeTop(target.statements, source.statements, 50);
  }

  _mergeStyle(target, source) {
    target.tone = source.tone || target.tone;
    target.formality = source.formality || target.formality;
    target.commonPhrases = this._mergeTop(target.commonPhrases, source.commonPhrases, 30);
    target.language = source.language || target.language;
    if (source.avgResponseLength > 0) {
      target.avgResponseLength = target.avgResponseLength
        ? Math.round((target.avgResponseLength + source.avgResponseLength) / 2)
        : source.avgResponseLength;
    }
    target.emojiUsage = target.emojiUsage + source.emojiUsage;
  }

  _mergeKnowledge(target, source) {
    for (const [topic, count] of Object.entries(source.topics || {})) {
      target.topics[topic] = (target.topics[topic] || 0) + count;
    }
    target.skills = this._mergeTop(target.skills, source.skills, 30);
    target.links = this._mergeTop(target.links, source.links, 50);
    target.facts = this._mergeTop(target.facts, source.facts, 100);
    target.domains = this._mergeTop(target.domains, source.domains, 20);
  }

  _mergeTaskLogic(target, source) {
    target.patterns = this._mergeTop(target.patterns, source.patterns, 20);
    target.workflows = this._mergeTop(target.workflows, source.workflows, 20);
    target.decisionIndicators = this._mergeTop(target.decisionIndicators, source.decisionIndicators, 20);
    if (source.questionFrequency > 0) {
      target.questionFrequency = target.questionFrequency
        ? Math.round((target.questionFrequency + source.questionFrequency) / 2)
        : source.questionFrequency;
    }
  }

  _mergeTop(existing, incoming, maxLen) {
    const map = new Map();
    for (const item of existing) {
      const key = typeof item === 'string' ? item : item.text || JSON.stringify(item);
      map.set(key, typeof item === 'string' ? 1 : (item.count || 1));
    }
    for (const item of incoming) {
      const key = typeof item === 'string' ? item : item.text || JSON.stringify(item);
      const incCount = typeof item === 'string' ? 1 : (item.count || 1);
      map.set(key, (map.get(key) || 0) + incCount);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxLen)
      .map(([k]) => k);
  }

  // -- Identity --
  _analyzeIdentity(conversations, profile) {
    const allMsgs = this._flatten(conversations);
    const ownMsgs = allMsgs.filter(m => !m.sender?.includes('@g.us') && !m.chatId?.includes('@g.us'))
      .filter(m => m.senderName !== null);

    const traits = [];
    const statements = [];

    // Extract self-referential statements
    const selfPatterns = [
      /\bI am\b.*/i, /\bI'm\b.*/i, /\bmy name\b.*/i,
      /\bI work\b.*/i, /\bI do\b.*/i, /\bI specialize\b.*/i,
      /\bI can\b.*help\b.*/i, /\bI handle\b.*/i,
      /\bI'm responsible\b.*/i, /\bI've been\b.*/i,
    ];

    for (const m of ownMsgs) {
      if (!m.content) continue;
      for (const pattern of selfPatterns) {
        const match = m.content.match(pattern);
        if (match) {
          const stmt = { text: match[0].trim(), source: m.chatName, date: m.timestamp?.slice(0, 10) };
          statements.push(stmt);
        }
      }
    }

    // Extract potential name
    let name = profile.identity.name;
    if (!name) {
      for (const m of ownMsgs) {
        const n = m.content?.match(/(?:my name is|I am|I'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        if (n) { name = n[1]; break; }
      }
      if (!name) name = ownMsgs.find(m => m.senderName)?.senderName || null;
    }

    // Infer traits from language patterns
    const allText = ownMsgs.map(m => m.content || '').join(' ');
    if (/\bplease\b|\bthanks\b|\bthank you\b/i.test(allText)) traits.push('polite');
    if (/\bsorry\b|\bapologies\b/i.test(allText)) traits.push('apologetic');
    if (/\bquick\b|\basap\b|\burgent\b/i.test(allText)) traits.push('urgent');
    if (/\bsure\b|\bof course\b|\bdefinitely\b/i.test(allText)) traits.push('accommodating');
    if (/\bproblem\b|\bissue\b|\bfix\b|\bsolve\b/i.test(allText)) traits.push('problem-solver');
    if (/\blet me check\b|\bI'll look into\b|\bI'll find out\b/i.test(allText)) traits.push('investigative');
    const avgLen = this._avgWordCount(ownMsgs);
    if (avgLen > 30) traits.push('detailed');
    else if (avgLen < 8) traits.push('concise');

    // Extract role
    let role = profile.identity.role;
    if (!role) {
      const rolePatterns = [
        /(?:I work as|I'm an?\s|I am an?\s|my role|my position)\s+([^.]+)/i,
        /(?:developer|engineer|manager|designer|consultant|analyst|admin|support|agent|assistant)/i,
      ];
      for (const m of ownMsgs) {
        for (const p of rolePatterns) {
          const match = m.content?.match(p);
          if (match) { role = match[1] || match[0]; break; }
        }
        if (role) break;
      }
    }

    return { name, role, traits: [...new Set(traits)], statements };
  }

  // -- Conversational Style --
  _analyzeStyle(conversations, profile) {
    const allMsgs = this._flatten(conversations);
    const ownMsgs = allMsgs.filter(m => !m.sender?.includes('@g.us') && !m.chatId?.includes('@g.us'))
      .filter(m => m.senderName !== null);

    const texts = ownMsgs.map(m => m.content || '').filter(Boolean);
    if (texts.length === 0) return profile.conversationalStyle;

    const allText = texts.join(' ');

    // Tone detection
    let tone = 'neutral';
    const questionRatio = (allText.match(/\?/g) || []).length / texts.length;
    const exclaimRatio = (allText.match(/!/g) || []).length / texts.length;
    if (exclaimRatio > 0.3) tone = 'enthusiastic';
    else if (questionRatio > 0.5) tone = 'inquisitive';
    if (/\b(haha|lol|lmao|😄|😂|😊)\b/i.test(allText)) tone = 'friendly';

    // Formality
    let formality = 'neutral';
    const formalWords = /\b(regarding|kindly|please|would you|appreciate|however|therefore|furthermore)\b/i;
    const informalWords = /\b(gonna|wanna|yeah|nah|hey|cool|awesome|dude)\b/i;
    const formalCount = (allText.match(formalWords) || []).length;
    const informalCount = (allText.match(informalWords) || []).length;
    if (formalCount > informalCount) formality = 'formal';
    else if (informalCount > formalCount) formality = 'informal';

    // Common phrases
    const bigrams = this._extractNgrams(texts, 2);
    const trigrams = this._extractNgrams(texts, 3);
    const commonPhrases = [...bigrams.slice(0, 10), ...trigrams.slice(0, 10)]
      .map(p => p.text);

    // Emoji usage
    const emojiCount = (allText.match(/[\u{1F000}-\u{1FFFF}]/gu) || []).length;

    // Avg response length
    const avgLen = this._avgWordCount(ownMsgs);

    // Language detection
    const lang = this._detectLanguage(texts);

    return {
      tone,
      formality,
      commonPhrases: [...new Set(commonPhrases)],
      avgResponseLength: Math.round(avgLen),
      emojiUsage: emojiCount,
      language: lang,
    };
  }

  // -- Knowledge Base --
  _analyzeKnowledge(conversations, profile) {
    const allMsgs = this._flatten(conversations);
    const texts = allMsgs.map(m => m.content || '').filter(Boolean);
    const allText = texts.join(' ');

    // Extract topics via keyword frequency
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
      'shall', 'should', 'may', 'might', 'must', 'i', 'you', 'he', 'she', 'it',
      'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its',
      'our', 'their', 'this', 'that', 'these', 'those', 'in', 'on', 'at', 'to',
      'for', 'with', 'by', 'about', 'into', 'through', 'during', 'before', 'after',
      'above', 'below', 'from', 'up', 'down', 'out', 'off', 'over', 'under',
      'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
      'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
      'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
      'too', 'very', 'just', 'because', 'as', 'until', 'while', 'of', 'and',
    ]);

    const words = allText.toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    const topics = Object.fromEntries(
      Object.entries(freq).filter(([_, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 50)
    );

    // Extract links
    const links = [];
    const linkPattern = /https?:\/\/[^\s]+/g;
    for (const t of texts) {
      const found = t.match(linkPattern);
      if (found) links.push(...found);
    }

    // Extract code snippets (potential skills)
    const codeIndicators = /\b(api|code|script|function|database|server|endpoint|json|html|css|javascript|python|node|react)\b/ig;
    const techTerms = new Set();
    for (const t of texts) {
      const matches = t.matchAll(codeIndicators);
      for (const m of matches) techTerms.add(m[0].toLowerCase());
    }

    // Detect domains
    const domainMap = {
      technology: /\b(code|software|app|website|server|database|api|programming)\b/i,
      business: /\b(company|team|project|deadline|budget|client|revenue|meeting)\b/i,
      education: /\b(learn|study|course|training|student|teacher|class|lesson)\b/i,
      health: /\b(doctor|hospital|medicine|health|symptom|pain|treatment)\b/i,
      finance: /\b(payment|invoice|money|cost|price|budget|transaction|bank)\b/i,
      support: /\b(issue|problem|fix|error|bug|help|assist|troubleshoot)\b/i,
    };
    const domains = [];
    for (const [domain, pattern] of Object.entries(domainMap)) {
      if (pattern.test(allText)) domains.push(domain);
    }

    return {
      topics,
      skills: [...techTerms],
      links: [...new Set(links)],
      facts: [],
      domains: [...new Set(domains)],
    };
  }

  // -- Task Logic --
  _analyzeTaskLogic(conversations, profile) {
    const allMsgs = this._flatten(conversations);

    // Group by conversation thread (simplified: same chat in sequence)
    const patterns = [];
    const workflows = [];
    const decisionIndicators = [];

    for (const [chat, msgs] of Object.entries(conversations)) {
      if (msgs.length < 2) continue;

      // Look for question-answer pairs
      for (let i = 0; i < msgs.length - 1; i++) {
        const current = msgs[i];
        const next = msgs[i + 1];

        if (!current.content || !next.content) continue;

        // Question asked by user, answered by the account
        if (/\?$/.test(current.content.trim()) && current.sender !== current.chatId) {
          patterns.push({ type: 'qa', question: current.content.slice(0, 100), answer: next.content.slice(0, 100) });
        }

        // Decision indicators
        const decisionWords = /\b(decided|chose|select|prefer|recommend|suggest|best|should|choose|option)\b/i;
        if (decisionWords.test(next.content)) {
          decisionIndicators.push({ text: next.content.slice(0, 100), context: current.content.slice(0, 60) });
        }

        // Workflow indicators
        if (/^(first|then|next|finally|step|start|begin)/i.test(next.content.trim())) {
          workflows.push({ step: next.content.slice(0, 100), trigger: current.content.slice(0, 60) });
        }
      }
    }

    // Question frequency
    const allText = allMsgs.map(m => m.content || '').join(' ');
    const questionCount = (allText.match(/\?/g) || []).length;
    const questionFrequency = allMsgs.length > 0 ? Math.round((questionCount / allMsgs.length) * 100) : 0;

    return {
      patterns: patterns.slice(0, 10),
      workflows: workflows.slice(0, 10),
      questionFrequency,
      avgResponseTime: 0,
      decisionIndicators: decisionIndicators.slice(0, 10),
    };
  }

  // -- Helpers --
  _flatten(conversations) {
    return Object.values(conversations).flat();
  }

  _extractNgrams(texts, n) {
    const freq = {};
    for (const t of texts) {
      const words = t.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
      for (let i = 0; i <= words.length - n; i++) {
        const ngram = words.slice(i, i + n).join(' ');
        if (ngram.length > n * 2) freq[ngram] = (freq[ngram] || 0) + 1;
      }
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([text, count]) => ({ text, count }));
  }

  _avgWordCount(msgs) {
    const counts = msgs.map(m => (m.content || '').split(/\s+/).filter(Boolean).length).filter(Boolean);
    if (counts.length === 0) return 0;
    return counts.reduce((a, b) => a + b, 0) / counts.length;
  }

  _detectLanguage(texts) {
    const sample = texts.join(' ').toLowerCase();
    const langSignals = {
      english: /\b(the|is|are|was|were|have|has|been|will|would|could|should|this|that|with|from|your|their)\b/g,
      malay: /\b(ada|dan|yang|ini|itu|saya|anda|kami|mereka|dengan|untuk|tidak|sudah|boleh|perlu|dapat|akan|telah|lagi|saja)\b/g,
      chinese: /[\u4e00-\u9fff]/g,
    };
    let max = 0;
    let lang = 'unknown';
    for (const [name, pattern] of Object.entries(langSignals)) {
      const count = (sample.match(pattern) || []).length;
      if (count > max) { max = count; lang = name; }
    }
    return lang;
  }
}

module.exports = ConversationAnalyzer;
