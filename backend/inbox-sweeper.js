/**
 * Inbox auto-archive — periyodik olarak okunmamış mailleri sınıflandırır,
 * promo/bildirim/spam olanları arşive taşır. LLM çağrıları cheap model üzerinden.
 *
 * Config: ~/.config/xjarvis/inbox-sweeper.json
 *   { enabled: bool, interval_minutes: number, archive_categories: [string],
 *     batch_size: number, dry_run: bool }
 *
 * State: ~/.config/xjarvis/inbox-sweeper-log.json (son sweep zamanı, sayım)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { exec } = require('child_process');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'inbox-sweeper.json');
const STATE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'inbox-sweeper-log.json');

const DEFAULT_CONFIG = {
  enabled: false,           // opt-in: yanlışlıkla mail kaybolmasın
  interval_minutes: 30,
  archive_categories: ['promo', 'notification', 'newsletter'],
  batch_size: 15,
  dry_run: false,
};

let config = { ...DEFAULT_CONFIG };
let timer = null;
let state = { last_run: null, last_archived: 0, last_kept: 0, total_archived: 0 };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')));
    }
  } catch (e) { console.warn('[sweep] load config:', e.message); }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      Object.assign(state, JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')));
    }
  } catch {}
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {}
}

function osascript(script, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

async function getUnreadMails(limit) {
  const script = `
    set out to ""
    tell application "Mail"
      set msgs to (messages of inbox whose read status is false)
      set n to count of msgs
      if n > ${limit} then set n to ${limit}
      repeat with i from 1 to n
        set m to item i of msgs
        set s to ""
        try
          set s to subject of m
        end try
        set f to ""
        try
          set f to sender of m
        end try
        set bid to ""
        try
          set bid to message id of m
        end try
        set out to out & i & "\\t" & f & "\\t" & s & "\\t" & bid & linefeed
      end repeat
    end tell
    return out
  `;
  const raw = await osascript(script, 15000);
  const mails = [];
  for (const line of raw.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const idx = parseInt(parts[0], 10);
    if (!idx) continue;
    mails.push({ index: idx, sender: parts[1] || '', subject: parts[2] || '', message_id: parts[3] || '' });
  }
  return mails;
}

async function archiveByMessageId(messageId) {
  const safe = messageId.replace(/['\\]/g, '');
  const script = `
    tell application "Mail"
      set hits to (every message of inbox whose message id is "${safe}")
      if (count of hits) > 0 then
        archive (item 1 of hits)
        return "OK"
      end if
    end tell
    return "MISS"
  `;
  try {
    const out = await osascript(script, 8000);
    return out.trim();
  } catch (e) { return `ERROR: ${e.message}`; }
}

function classify(mails) {
  // Returns array of {index, category}
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

  const lines = mails.map((m, i) => `${i + 1}. From: ${m.sender}\n   Subject: ${m.subject}`).join('\n\n');
  const sys = `You triage emails. Categories:
- promo: marketing, sales, discount codes, product announcements
- notification: automated alerts, status updates, "you have a new..."
- newsletter: regular content updates, blog posts, digests
- personal: from a real person, addresses recipient by name, conversation
- important: receipts, security, billing, legal, account changes
- other: anything ambiguous

Reply ONLY with a JSON array, one entry per email, in input order:
[{"i": 1, "category": "promo"}, {"i": 2, "category": "personal"}, ...]
No prose, no markdown fences.`;

  const payload = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `Classify these ${mails.length} emails:\n\n${lines}` },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'XJarvis-InboxSweeper',
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const content = j.choices?.[0]?.message?.content || '';
          // Some models wrap arrays in {classifications: [...]}; handle both
          const stripped = content.trim().replace(/^```\w*\n?|\n?```$/g, '');
          const parsed = JSON.parse(stripped);
          const arr = Array.isArray(parsed) ? parsed : (parsed.classifications || parsed.results || []);
          resolve(arr);
        } catch (e) {
          console.warn('[sweep] classify parse:', e.message);
          resolve(null);
        }
      });
    });
    req.on('error', (e) => { console.warn('[sweep] classify req:', e.message); resolve(null); });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

async function sweep() {
  if (!config.enabled) return { skipped: 'disabled' };
  let mails;
  try {
    mails = await getUnreadMails(config.batch_size);
  } catch (e) {
    return { error: `read mail: ${e.message}` };
  }
  if (!mails.length) {
    state.last_run = new Date().toISOString();
    state.last_archived = 0;
    state.last_kept = 0;
    saveState();
    return { archived: 0, kept: 0 };
  }

  const classifications = await classify(mails);
  if (!classifications) {
    return { error: 'classify failed' };
  }

  const targets = new Set(config.archive_categories.map((c) => c.toLowerCase()));
  let archived = 0;
  let kept = 0;
  const actions = [];

  for (const c of classifications) {
    const i = (c.i ?? c.index) - 1;
    const mail = mails[i];
    if (!mail) continue;
    const cat = (c.category || '').toLowerCase();
    const willArchive = targets.has(cat);
    if (willArchive && !config.dry_run && mail.message_id) {
      const r = await archiveByMessageId(mail.message_id);
      if (r === 'OK') {
        archived++;
        actions.push({ ...mail, category: cat, action: 'archived' });
      } else {
        kept++;
        actions.push({ ...mail, category: cat, action: 'archive_failed' });
      }
    } else if (willArchive && config.dry_run) {
      archived++;
      actions.push({ ...mail, category: cat, action: 'would_archive' });
    } else {
      kept++;
      actions.push({ ...mail, category: cat, action: 'kept' });
    }
  }

  state.last_run = new Date().toISOString();
  state.last_archived = archived;
  state.last_kept = kept;
  state.total_archived = (state.total_archived || 0) + (config.dry_run ? 0 : archived);
  saveState();
  console.log(`[sweep] ${archived} archived, ${kept} kept (dry=${config.dry_run})`);
  return { archived, kept, actions };
}

function start() {
  loadConfig();
  loadState();
  if (timer) clearInterval(timer);
  const ms = Math.max(5, config.interval_minutes) * 60 * 1000;
  timer = setInterval(() => sweep().catch((e) => console.warn('[sweep] tick:', e.message)), ms);
  console.log(`[sweep] started (every ${config.interval_minutes}m, enabled=${config.enabled})`);
}

function getConfig() { return { ...config, ...state }; }
function setConfig(patch) {
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
  if (typeof patch.interval_minutes === 'number' && patch.interval_minutes >= 5) {
    config.interval_minutes = Math.round(patch.interval_minutes);
  }
  if (Array.isArray(patch.archive_categories)) {
    config.archive_categories = patch.archive_categories.filter((s) => typeof s === 'string');
  }
  if (typeof patch.batch_size === 'number' && patch.batch_size >= 1 && patch.batch_size <= 50) {
    config.batch_size = Math.round(patch.batch_size);
  }
  if (typeof patch.dry_run === 'boolean') config.dry_run = patch.dry_run;
  saveConfig();
  start();
  return getConfig();
}

async function runNow() { return sweep(); }

module.exports = { start, getConfig, setConfig, runNow };
