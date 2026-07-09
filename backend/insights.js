/**
 * Proactive insights — günde bir kez cross-connector pattern detection.
 *
 * Senaryolar:
 *   • WHOOP/Oura recovery düşük + bugün yoğun calendar → "ağır gün, ısınma yap"
 *   • Strava haftalık koşu km düşüş + uyku kötüleşme → "form düşüşü"
 *   • Inbox unread 100+ → "inbox triage öner"
 *   • Yarın doğum günü olan kişiler (apple_contacts metadata) → reminder
 *
 * Output: tek mesaj olarak Telegram'a, opsiyonel WS event UI'ya.
 *
 * Config: ~/.config/xjarvis/insights.json { enabled, time: "HH:MM" }
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { sendToAllowlist } = require('./telegram');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'insights.json');
const STATE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'insights-last.txt');

let config = { enabled: true, time: '20:00' };
let timer = null;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')));
  } catch {}
}
function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
function lastDay() { try { return fs.readFileSync(STATE_PATH, 'utf-8').trim(); } catch { return ''; } }
function markSent(day) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, day);
}

function osascript(script, ms = 8000) {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve('');  // osascript yalnız macOS
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: ms }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

function getJson(url, headers = {}) {
  return new Promise((resolve) => {
    https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function getWhoopSummary() {
  const token = (process.env.WHOOP_ACCESS_TOKEN || '').trim();
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}` };
  const rec = await getJson('https://api.prod.whoop.com/developer/v1/recovery?limit=2', headers);
  const slp = await getJson('https://api.prod.whoop.com/developer/v1/activity/sleep?limit=2', headers);
  const recItems = rec?.records || [];
  if (!recItems.length) return null;
  const latest = recItems[0]?.score || {};
  const prev = recItems[1]?.score || {};
  const sleepLatest = slp?.records?.[0]?.score?.sleep_performance_percentage;
  return {
    recovery: latest.recovery_score,
    recovery_prev: prev.recovery_score,
    hrv: latest.hrv_rmssd_milli,
    rhr: latest.resting_heart_rate,
    sleep_perf: sleepLatest,
  };
}

async function countTodayEvents() {
  const s = `
    set cnt to 0
    set d to current date
    set h of d to 0
    set m of d to 0
    set s of d to 0
    set tomorrow to d + 1 * days
    tell application "Calendar"
      repeat with c in calendars
        set cnt to cnt + (count of (events of c whose start date ≥ d and start date < tomorrow))
      end repeat
    end tell
    return cnt
  `;
  const raw = await osascript(s, 12000);
  return parseInt(raw, 10) || 0;
}

async function countUnreadMail() {
  const r = await osascript('tell application "Mail" to count (messages of inbox whose read status is false)', 8000);
  return parseInt(r, 10) || 0;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function buildInsights() {
  const [whoop, eventCount, unread] = await Promise.all([
    getWhoopSummary(), countTodayEvents(), countUnreadMail(),
  ]);

  const insights = [];

  if (whoop) {
    if (typeof whoop.recovery === 'number' && whoop.recovery < 50 && eventCount >= 4) {
      insights.push(
        `🔋 Recovery düşük (${whoop.recovery}%) ve bugün ${eventCount} toplantı var — ` +
        `mola planlamayı unutmayın efendim. Mümkünse 2'sini erteleyin.`,
      );
    }
    if (typeof whoop.recovery === 'number' && typeof whoop.recovery_prev === 'number') {
      const drop = whoop.recovery_prev - whoop.recovery;
      if (drop >= 20) {
        insights.push(
          `📉 Recovery dün ${whoop.recovery_prev}% → bugün ${whoop.recovery}% (-${drop}%). ` +
          `Antrenmanı hafif tutun.`,
        );
      }
    }
    if (typeof whoop.sleep_perf === 'number' && whoop.sleep_perf < 70) {
      insights.push(
        `😴 Uyku performansı dün ${whoop.sleep_perf}% — bugün kafein ve geç ekran kullanımına dikkat.`,
      );
    }
  }

  if (unread > 100) {
    insights.push(`📧 Inbox'ta ${unread} okunmamış mail var — inbox sweeper çalıştırmak ister misiniz?`);
  }

  if (eventCount >= 6) {
    insights.push(`📅 Bugün ${eventCount} toplantı — yoğun bir gün. Buffer time ekleyin.`);
  }

  if (!insights.length) {
    return { text: '', insights: [] };
  }

  const lines = [`💡 <b>Günlük insight — ${new Date().toLocaleDateString('tr-TR')}</b>`, ''];
  insights.forEach((i) => lines.push(`• ${escapeHtml(i)}`));
  return { text: lines.join('\n'), insights };
}

async function maybeSend() {
  if (!config.enabled) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  if (`${hh}:${mm}` !== config.time) return;
  const today = now.toISOString().slice(0, 10);
  if (lastDay() === today) return;

  const { text, insights } = await buildInsights();
  if (!text) { markSent(today); return; }
  const r = await sendToAllowlist(text);
  if (r.ok) { markSent(today); console.log('[insights] sent', insights.length); }
}

async function sendNow() {
  const { text, insights } = await buildInsights();
  if (!text) return { ok: true, empty: true };
  const r = await sendToAllowlist(text);
  if (r.ok) markSent(new Date().toISOString().slice(0, 10));
  return { ok: r.ok, error: r.error, count: insights.length, preview: text.slice(0, 240) };
}

function start() {
  loadConfig();
  if (timer) clearInterval(timer);
  timer = setInterval(() => maybeSend().catch(() => {}), 30_000);
  console.log(`[insights] watcher started (target ${config.time}, enabled=${config.enabled})`);
}

function getConfig() { return { ...config, last_sent_day: lastDay() }; }
function setConfig(patch) {
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
  if (typeof patch.time === 'string' && /^\d{2}:\d{2}$/.test(patch.time)) config.time = patch.time;
  saveConfig();
  return getConfig();
}

function shouldHandle(url) { return url.startsWith('/api/insights'); }
function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/api/insights/preview') {
    return buildInsights().then(({ text, insights }) => {
      res.writeHead(200); res.end(JSON.stringify({ text, insights }));
    });
  }
  if (req.method === 'GET' && req.url === '/api/insights/config') {
    res.writeHead(200); res.end(JSON.stringify(getConfig())); return;
  }
  if (req.method === 'POST' && req.url === '/api/insights/config') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const patch = JSON.parse(body || '{}');
        res.writeHead(200); res.end(JSON.stringify(setConfig(patch)));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/insights/send') {
    return sendNow().then((r) => { res.writeHead(200); res.end(JSON.stringify(r)); });
  }
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { start, sendNow, getConfig, setConfig, buildInsights, handleHttp, shouldHandle };
