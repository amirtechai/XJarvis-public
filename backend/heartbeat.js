/**
 * Proactive heartbeat — saatte bir LLM-driven brain loop.
 *
 * Sabit cron (morning-brief, insights) yerine: bağlamı topla, LLM'e ver,
 * "şu an ne yapmak/söylemek lazım?" diye sor. LLM JSON döner; aksiyon varsa
 * Telegram'a bildir, yoksa sus.
 *
 * Bu modül "Samantha (Her) / JARVIS heartbeat" davranışının çekirdeği.
 *
 * Config: ~/.config/xjarvis/heartbeat.json
 *   { enabled, interval_min: 60, quiet_start: "23:00", quiet_end: "08:00" }
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { sendToAllowlist } = require('./telegram');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'heartbeat.json');
const STATE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'heartbeat-log.jsonl');

let config = {
  enabled: false,           // varsayılan kapalı — kullanıcı açsın (privacy + cost)
  interval_min: 60,
  quiet_start: '23:00',
  quiet_end: '08:00',
  cooldown_min: 30,         // aynı tetik 30 dk içinde tekrar etmesin
};
let timer = null;
let lastBeatAt = 0;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')));
  } catch {}
}
function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function appendLog(entry) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.appendFileSync(STATE_PATH, JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
  } catch {}
}

function readRecentLog(maxEntries = 20) {
  try {
    const lines = fs.readFileSync(STATE_PATH, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-maxEntries).map((l) => JSON.parse(l)).reverse();
  } catch { return []; }
}

function isQuietNow() {
  const [qs1, qs2] = config.quiet_start.split(':').map(Number);
  const [qe1, qe2] = config.quiet_end.split(':').map(Number);
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = qs1 * 60 + qs2;
  const end = qe1 * 60 + qe2;
  // Wraps around midnight
  return start > end ? (cur >= start || cur < end) : (cur >= start && cur < end);
}

function osascript(script, timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve('');  // osascript yalnız macOS
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: timeoutMs }, (err, stdout) => {
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

async function gatherContext() {
  const ctx = { now: new Date().toISOString() };

  // Calendar — next 6h events
  try {
    const s = `
      set out to ""
      set d to current date
      set horizon to d + 6 * hours
      tell application "Calendar"
        repeat with c in calendars
          repeat with e in (events of c whose start date ≥ d and start date < horizon)
            set out to out & (summary of e) & " @ " & ((start date of e) as string) & linefeed
          end repeat
        end repeat
      end tell
      return out
    `;
    const raw = await osascript(s, 12000);
    ctx.upcoming_events = raw.split('\n').filter(Boolean).slice(0, 5);
  } catch { ctx.upcoming_events = []; }

  // Mail — unread count
  try {
    const r = await osascript('tell application "Mail" to count (messages of inbox whose read status is false)', 8000);
    ctx.unread_mail = parseInt(r, 10) || 0;
  } catch { ctx.unread_mail = null; }

  // Reminders — overdue
  try {
    const s = `
      set cnt to 0
      tell application "Reminders"
        repeat with l in (lists)
          repeat with r in (reminders of l whose completed is false)
            try
              set d to due date of r
              if d is not missing value and d < (current date) then set cnt to cnt + 1
            end try
          end repeat
        end repeat
      end tell
      return cnt
    `;
    ctx.overdue_reminders = parseInt(await osascript(s, 12000), 10) || 0;
  } catch { ctx.overdue_reminders = null; }

  // WHOOP recovery
  const token = (process.env.WHOOP_ACCESS_TOKEN || '').trim();
  if (token) {
    const rec = await getJson('https://api.prod.whoop.com/developer/v1/recovery?limit=1', { Authorization: `Bearer ${token}` });
    const slp = await getJson('https://api.prod.whoop.com/developer/v1/activity/sleep?limit=1', { Authorization: `Bearer ${token}` });
    ctx.whoop = {
      recovery: rec?.records?.[0]?.score?.recovery_score,
      hrv: rec?.records?.[0]?.score?.hrv_rmssd_milli,
      sleep_perf: slp?.records?.[0]?.score?.sleep_performance_percentage,
    };
  }

  // Episodik bellek — son 3 günün özetleri (RAG değil, anlatı)
  try {
    const em = require('./episodic-memory');
    ctx.recent_days = em.getRecent(3).map((d) => ({
      date: d.date, summary: d.summary, key_facts: d.key_facts,
    }));
  } catch { ctx.recent_days = []; }

  // Active long-term goals — LLM bunları proaktif kararlarda kullanır
  try {
    const goalsMod = require('./goals');
    ctx.active_goals = goalsMod.listGoals(false).map((g) => ({
      title: g.title,
      progress_pct: g.progress_pct,
      deadline: g.deadline,
      last_summary: g.recent_checkins?.[0]?.summary || null,
    }));
  } catch { ctx.active_goals = []; }

  // Screen context (eğer screen-awareness açıksa)
  try {
    const sc = require('./screen-awareness').getConfig();
    if (sc.enabled && sc.last_context) {
      ctx.screen = { ts: sc.last_context.ts, summary: sc.last_context.summary };
    }
  } catch {}

  // Recent heartbeat actions (suppress duplicates)
  ctx.recent_actions = readRecentLog(8).map((e) => ({
    minutes_ago: Math.round((Date.now() - e.ts) / 60000),
    action: e.action,
    summary: e.summary,
  }));

  return ctx;
}

function callLLM(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_HEARTBEAT_MODEL || process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

  const payload = JSON.stringify({
    model,
    messages,
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'XJarvis-Heartbeat',
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const content = j.choices?.[0]?.message?.content || '{}';
          const stripped = content.trim().replace(/^```\w*\n?|\n?```$/g, '');
          resolve(JSON.parse(stripped));
        } catch (e) {
          console.warn('[heartbeat] LLM parse:', e.message);
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.write(payload);
    req.end();
  });
}

const SYSTEM_PROMPT = `Sen JARVIS'in proaktif "kalp atışı" beynisin. Her saat çalışırsın ve kullanıcının makro durumuna bakıp NE GEREKİYORSA SÖYLER veya YAPARSIN — gerekmiyorsa SUSARSIN.

Kurallar:
1. Saatte bir tekrarlanan, gereksiz uyarı gönderme. recent_actions'a bak; aynı temayı 2 saatten önce tekrarlama.
2. Quiet hours mantığı zaten dışarıda — sen geldiğine göre uyandırma izni var, ama yine de değer kat.
3. Mesaj kısa, net, eylem odaklı olsun. Türkçe ve "efendim" hitabını ara sıra kullanan JARVIS tonu.
4. Aksiyon yoksa action="none" döndür ve geç.
5. Cevabın MUTLAKA şu JSON şemasında olsun:
{
  "action": "notify" | "none",
  "summary": "<recent_actions için 1-2 kelime özet, örn 'recovery_warning'>",
  "message": "<Telegram'a gidecek tam HTML mesaj — boş bırakma eğer action='notify' ise>",
  "reason": "<karar gerekçen, kısa>"
}

Tetik fikirleri (hepsi sürekli değil — sadece bağlam destekliyorsa):
- 1 saat içinde toplantı var ve kullanıcı bilmiyor olabilir → hatırlat
- Recovery düşük + bugün yoğun → mola öner
- Overdue reminder birikmiş → triage öner
- Unread mail patlamış → sweep öner
- Aksi halde ya sessiz ya da nazik bir gözlem (gün sonu özet, motivasyon değil)

Asla sahte bilgi uydurma. Bağlamda olmayan şeyi söyleme.`;

async function beat({ force = false, dryRun = false } = {}) {
  if (!force) {
    if (!config.enabled) return { skipped: 'disabled' };
    if (isQuietNow()) return { skipped: 'quiet_hours' };
    const elapsed = (Date.now() - lastBeatAt) / 60000;
    if (elapsed < config.cooldown_min) return { skipped: `cooldown(${Math.round(elapsed)}m)` };
  }

  const ctx = await gatherContext();
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Bağlam:\n${JSON.stringify(ctx, null, 2)}\n\nNe yapacaksın?` },
  ];

  const decision = await callLLM(messages);
  if (!decision) return { skipped: 'llm_failed', context: ctx };

  if (decision.action === 'notify' && decision.message) {
    if (!dryRun) {
      const r = await sendToAllowlist(decision.message);
      appendLog({ action: 'notify', summary: decision.summary || '', reason: decision.reason || '', sent_ok: r.ok });
      lastBeatAt = Date.now();
      console.log('[heartbeat] notified:', decision.summary || decision.reason || '');
      return { ok: true, decision, context: ctx, sent: r.ok };
    }
    return { ok: true, decision, context: ctx, dry_run: true };
  }

  appendLog({ action: 'none', summary: decision.summary || '', reason: decision.reason || '' });
  lastBeatAt = Date.now();
  return { ok: true, decision, context: ctx };
}

async function tick() {
  try { await beat(); }
  catch (e) { console.warn('[heartbeat] tick err:', e.message); }
}

function start() {
  loadConfig();
  if (timer) clearInterval(timer);
  // Tick every interval_min minutes; first tick after a 30s delay so server boot is clean.
  setTimeout(() => { tick(); timer = setInterval(tick, config.interval_min * 60_000); }, 30_000);
  console.log(`[heartbeat] watcher started (every ${config.interval_min}m, enabled=${config.enabled})`);
}

function getConfig() { return { ...config, last_beat_at: lastBeatAt, recent: readRecentLog(5) }; }
function setConfig(patch) {
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
  if (typeof patch.interval_min === 'number' && patch.interval_min >= 5) config.interval_min = patch.interval_min;
  if (typeof patch.quiet_start === 'string' && /^\d{2}:\d{2}$/.test(patch.quiet_start)) config.quiet_start = patch.quiet_start;
  if (typeof patch.quiet_end === 'string' && /^\d{2}:\d{2}$/.test(patch.quiet_end)) config.quiet_end = patch.quiet_end;
  if (typeof patch.cooldown_min === 'number' && patch.cooldown_min >= 5) config.cooldown_min = patch.cooldown_min;
  saveConfig();
  // Restart timer with new interval
  start();
  return getConfig();
}

function shouldHandle(url) { return url.startsWith('/api/heartbeat'); }
function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/api/heartbeat/config') {
    res.writeHead(200); res.end(JSON.stringify(getConfig())); return;
  }
  if (req.method === 'POST' && req.url === '/api/heartbeat/config') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const patch = JSON.parse(body || '{}');
        res.writeHead(200); res.end(JSON.stringify(setConfig(patch)));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/heartbeat/run') {
    return beat({ force: true }).then((r) => { res.writeHead(200); res.end(JSON.stringify(r)); });
  }
  if (req.method === 'POST' && req.url === '/api/heartbeat/dry-run') {
    return beat({ force: true, dryRun: true }).then((r) => { res.writeHead(200); res.end(JSON.stringify(r)); });
  }
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { start, beat, getConfig, setConfig, handleHttp, shouldHandle };
