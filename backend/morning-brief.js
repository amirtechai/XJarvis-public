/**
 * Morning brief — günde bir kez (default 08:00) Telegram'a günün özeti.
 * Toplar: bugünün etkinlikleri (Calendar), okunmamış mail sayısı, vadesi gelen
 * hatırlatıcılar, hava durumu (open-meteo, key-free).
 *
 * Config:  ~/.config/xjarvis/morning-brief.json  { enabled, time: "HH:MM" }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { exec } = require('child_process');
const { sendToAllowlist } = require('./telegram');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'morning-brief.json');
const STATE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'morning-brief-last.txt');

let config = { enabled: true, time: '08:00' };
let timer = null;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')));
    }
  } catch (e) { console.warn('[brief] load:', e.message); }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function lastSentDay() {
  try { return fs.readFileSync(STATE_PATH, 'utf-8').trim(); } catch { return ''; }
}

function markSent(day) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, day);
}

function osascript(script, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') return reject(new Error('osascript yalnız macOS'));  // çağıranlar try/catch'li
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

async function getTodayEvents() {
  try {
    const s = `
      set out to ""
      set d to current date
      set h of d to 0
      set m of d to 0
      set s of d to 0
      set tomorrow to d + 1 * days
      tell application "Calendar"
        repeat with c in calendars
          repeat with e in (events of c whose start date ≥ d and start date < tomorrow)
            set out to out & (summary of e) & " @ " & ((start date of e) as string) & linefeed
          end repeat
        end repeat
      end tell
      return out
    `;
    const raw = await osascript(s, 15000);
    return raw.split('\n').filter(Boolean).slice(0, 10);
  } catch { return []; }
}

async function getUnreadMailCount() {
  try {
    const r = await osascript('tell application "Mail" to count (messages of inbox whose read status is false)', 8000);
    return parseInt(r, 10) || 0;
  } catch { return null; }
}

async function getDueReminders() {
  try {
    const s = `
      set out to ""
      tell application "Reminders"
        repeat with l in (lists)
          repeat with r in (reminders of l whose completed is false)
            try
              set d to due date of r
              if d is not missing value then
                if d ≤ (current date) + 1 * days then
                  set out to out & (name of r) & linefeed
                end if
              end if
            end try
          end repeat
        end repeat
      end tell
      return out
    `;
    const raw = await osascript(s, 12000);
    return raw.split('\n').filter(Boolean).slice(0, 10);
  } catch { return []; }
}

function getWeather() {
  return new Promise((resolve) => {
    const lat = process.env.WEATHER_LATITUDE || '41.0082';
    const lon = process.env.WEATHER_LONGITUDE || '28.9784';
    const tz = process.env.WEATHER_TIMEZONE || 'Europe/Istanbul';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_min,temperature_2m_max,precipitation_probability_max&timezone=${encodeURIComponent(tz)}`;
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const t = j.current?.temperature_2m;
          const min = j.daily?.temperature_2m_min?.[0];
          const max = j.daily?.temperature_2m_max?.[0];
          const rain = j.daily?.precipitation_probability_max?.[0];
          if (t === undefined) return resolve(null);
          resolve({ now: t, min, max, rain });
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function buildBrief() {
  const [events, unread, reminders, weather] = await Promise.all([
    getTodayEvents(), getUnreadMailCount(), getDueReminders(), getWeather(),
  ]);
  const day = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const lines = [`🌅 <b>Günaydın efendim — ${escapeHtml(day)}</b>`];

  if (weather) {
    const rainLine = weather.rain != null ? ` · ☔ %${weather.rain}` : '';
    lines.push(`\n🌡 ${weather.now}°C (gün: ${weather.min}–${weather.max}°C)${rainLine}`);
  }

  lines.push(`\n📅 <b>Bugün ${events.length} etkinlik</b>`);
  if (events.length) lines.push(events.slice(0, 5).map((e) => `  • ${escapeHtml(e)}`).join('\n'));

  if (unread != null) lines.push(`\n📧 ${unread} okunmamış mail`);

  lines.push(`\n🔔 <b>Vadesi gelen ${reminders.length} hatırlatıcı</b>`);
  if (reminders.length) lines.push(reminders.slice(0, 5).map((r) => `  • ${escapeHtml(r)}`).join('\n'));

  return lines.join('\n');
}

async function maybeSend() {
  if (!config.enabled) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const today = now.toISOString().slice(0, 10);
  if (`${hh}:${mm}` !== config.time) return;
  if (lastSentDay() === today) return;

  try {
    const text = await buildBrief();
    const r = await sendToAllowlist(text);
    if (r.ok) { markSent(today); console.log('[brief] sent for', today); }
    else console.warn('[brief] send fail:', r.error);
  } catch (e) {
    console.warn('[brief] build/send error:', e.message);
  }
}

function start() {
  loadConfig();
  if (timer) clearInterval(timer);
  timer = setInterval(() => maybeSend().catch(() => {}), 30_000);
  console.log(`[brief] watcher started (target ${config.time}, enabled=${config.enabled})`);
}

function getConfig() { return { ...config, last_sent_day: lastSentDay() }; }
function setConfig(patch) {
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
  if (typeof patch.time === 'string' && /^\d{2}:\d{2}$/.test(patch.time)) config.time = patch.time;
  saveConfig();
  return getConfig();
}
async function sendNow() {
  const text = await buildBrief();
  const r = await sendToAllowlist(text);
  if (r.ok) markSent(new Date().toISOString().slice(0, 10));
  return r;
}

module.exports = { start, getConfig, setConfig, sendNow };
