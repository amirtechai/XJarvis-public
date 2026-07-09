/**
 * Reminders watcher — polls macOS Reminders.app every 60s and pings Telegram
 * allowlist for due reminders (one-shot per reminder ID).
 *
 * Pinged-IDs are stored in ~/.config/xjarvis/reminders-pinged.json so we
 * don't double-ping across restarts.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { sendToAllowlist } = require('./telegram');

const STATE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'reminders-pinged.json');
const POLL_MS = 60_000;

let pinged = new Set();
let timer = null;
let enabled = true;

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const arr = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
      pinged = new Set(Array.isArray(arr) ? arr : []);
    }
  } catch (e) {
    console.warn('[reminders] state load failed:', e.message);
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const arr = [...pinged].slice(-500);
    fs.writeFileSync(STATE_PATH, JSON.stringify(arr));
  } catch (e) {
    console.warn('[reminders] state save failed:', e.message);
  }
}

function osascript(script, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

async function getDueReminders() {
  const script = `
    set out to ""
    tell application "Reminders"
      repeat with l in (lists)
        repeat with r in (reminders of l whose completed is false)
          try
            set d to due date of r
            if d is not missing value then
              if d ≤ (current date) then
                set out to out & (id of r) & "|" & (name of r) & "|" & ((d) as «class isot» as string) & linefeed
              end if
            end if
          end try
        end repeat
      end repeat
    end tell
    return out
  `;
  const raw = await osascript(script, 12000);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const [id, name, due] = line.split('|');
    return { id, name: (name || '').trim(), due: (due || '').trim() };
  });
}

async function tick() {
  if (!enabled) return;
  let due;
  try { due = await getDueReminders(); }
  catch (e) {
    console.warn('[reminders] poll failed:', e.message);
    return;
  }
  const fresh = due.filter((r) => r.id && !pinged.has(r.id));
  if (fresh.length === 0) return;

  const lines = fresh.map((r) => `🔔 <b>${escapeHtml(r.name)}</b>\n<i>${escapeHtml(r.due)}</i>`);
  const text = `<b>Hatırlatıcı:</b>\n\n${lines.join('\n\n')}`;
  const res = await sendToAllowlist(text);
  if (res.ok) {
    fresh.forEach((r) => pinged.add(r.id));
    saveState();
    console.log(`[reminders] pinged ${fresh.length} due reminder(s)`);
  } else {
    console.warn('[reminders] telegram send failed:', res.error || 'unknown');
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function start() {
  loadState();
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick().catch((e) => console.error('[reminders] tick:', e)), POLL_MS);
  // initial tick after 10s so backend finishes booting
  setTimeout(() => tick().catch(() => {}), 10_000);
  console.log('[reminders] watcher started (60s poll)');
}

function setEnabled(v) { enabled = !!v; }
function getState() { return { enabled, pinged_count: pinged.size }; }

module.exports = { start, setEnabled, getState };
