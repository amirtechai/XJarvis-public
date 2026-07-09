/**
 * Meeting detector — toplantıdan ~5 dakika önce zoom/meet/teams linkini aç +
 * Telegram'a hatırlatma. Her etkinlik en fazla bir kez tetiklenir.
 *
 * Config: ~/.config/xjarvis/meeting-detector.json
 *   { enabled: bool, lead_minutes: number, open_link: bool, notify: bool }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { sendToAllowlist } = require('./telegram');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'meeting-detector.json');
const STATE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'meeting-detector-fired.json');

let config = { enabled: true, lead_minutes: 5, open_link: true, notify: true };
let timer = null;
let firedIds = new Set();

const URL_RE = /https?:\/\/[^\s<>"')]+/g;
const MEETING_HOST_RE = /(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|whereby\.com|webex\.com|gotomeeting\.com|hangouts\.google\.com)/i;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')));
    }
  } catch (e) { console.warn('[meeting] load:', e.message); }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadFired() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    if (raw.day === today()) firedIds = new Set(raw.ids || []);
    else firedIds = new Set();
  } catch { firedIds = new Set(); }
}

function persistFired() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ day: today(), ids: [...firedIds] }));
  } catch (e) { console.warn('[meeting] persist:', e.message); }
}

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function osascript(script, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

async function getUpcomingEvents() {
  const s = `
    set out to ""
    set d to current date
    set later to d + 30 * minutes
    tell application "Calendar"
      repeat with c in calendars
        repeat with e in (events of c whose start date ≥ d and start date ≤ later)
          set theURL to ""
          try
            set theURL to URL of e
          end try
          set theLoc to ""
          try
            set theLoc to location of e
          end try
          set theDesc to ""
          try
            set theDesc to description of e
          end try
          set out to out & (uid of e) & "\\t" & (summary of e) & "\\t" & ((start date of e) as string) & "\\t" & theURL & "\\t" & theLoc & "\\t" & theDesc & linefeed
        end repeat
      end repeat
    end tell
    return out
  `;
  try {
    const raw = await osascript(s, 15000);
    const events = [];
    for (const line of raw.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const [uid, summary, startStr, url, loc, desc] = parts;
      if (!uid || !summary) continue;
      const start = parseAppleScriptDate(startStr);
      if (!start) continue;
      events.push({ uid, summary, start, url, loc, desc: desc || '' });
    }
    return events;
  } catch (e) {
    console.warn('[meeting] read events:', e.message);
    return [];
  }
}

function parseAppleScriptDate(s) {
  // AppleScript date string is locale-dependent; try Date constructor first
  const d = new Date(s);
  if (!isNaN(d)) return d;
  return null;
}

function extractMeetingUrl(event) {
  const haystack = [event.url, event.loc, event.desc].filter(Boolean).join(' ');
  const matches = haystack.match(URL_RE) || [];
  for (const u of matches) {
    if (MEETING_HOST_RE.test(u)) return u;
  }
  // First URL fallback
  return matches[0] || '';
}

function fmtTime(d) {
  return d.toTimeString().slice(0, 5);
}

async function fireMeeting(event) {
  const url = extractMeetingUrl(event);
  const minutesUntil = Math.max(0, Math.round((event.start.getTime() - Date.now()) / 60000));
  const lines = [
    `🎥 <b>Toplantı ${minutesUntil} dakikaya başlıyor</b>`,
    `<b>${escapeHtml(event.summary)}</b> @ ${fmtTime(event.start)}`,
  ];
  if (url) lines.push(`<a href="${url}">Linke katıl</a>`);
  if (event.loc && !url) lines.push(`Konum: ${escapeHtml(event.loc)}`);

  if (config.notify) {
    try { await sendToAllowlist(lines.join('\n')); } catch (e) { console.warn('[meeting] tg:', e.message); }
  }
  if (config.open_link && url) {
    exec(`open ${JSON.stringify(url)}`, (err) => {
      if (err) console.warn('[meeting] open:', err.message);
    });
  }
  console.log(`[meeting] fired '${event.summary}' (${minutesUntil}m, url=${url || 'none'})`);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function tick() {
  if (!config.enabled) return;
  const events = await getUpcomingEvents();
  const now = Date.now();
  const lead = config.lead_minutes * 60 * 1000;

  for (const ev of events) {
    const delta = ev.start.getTime() - now;
    if (delta < 0 || delta > lead + 60_000) continue;
    if (firedIds.has(ev.uid)) continue;
    firedIds.add(ev.uid);
    persistFired();
    await fireMeeting(ev);
  }
}

function start() {
  loadConfig();
  loadFired();
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick().catch((e) => console.warn('[meeting] tick:', e.message)), 60_000);
  // First tick after 5s so we don't block boot
  setTimeout(() => tick().catch(() => {}), 5000);
  console.log(`[meeting] watcher started (lead=${config.lead_minutes}m, enabled=${config.enabled})`);
}

function getConfig() {
  return { ...config, fired_today: firedIds.size };
}

function setConfig(patch) {
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
  if (typeof patch.lead_minutes === 'number' && patch.lead_minutes >= 1 && patch.lead_minutes <= 60) {
    config.lead_minutes = Math.round(patch.lead_minutes);
  }
  if (typeof patch.open_link === 'boolean') config.open_link = patch.open_link;
  if (typeof patch.notify === 'boolean') config.notify = patch.notify;
  saveConfig();
  return getConfig();
}

async function fireNow() {
  const events = await getUpcomingEvents();
  if (!events.length) return { ok: false, error: 'no upcoming events' };
  await fireMeeting(events[0]);
  return { ok: true, summary: events[0].summary };
}

module.exports = { start, getConfig, setConfig, fireNow };
