/**
 * Meeting brief — sıradaki toplantı için cross-connector özet.
 *
 * Yaklaşan Calendar etkinliğini bulur, katılımcılarını çıkarır, knowledge
 * store'da (Granola, Gmail, Slack, Telegram, Notes…) o kişiler/konu hakkında
 * son ay içindeki ilgili kayıtları toplar ve kullanıcıya kısa bir brief
 * üretir. Manuel tetikleme veya 15 dk öncesi otomatik gönderim.
 */
const { spawn } = require('child_process');
const { exec } = require('child_process');
const path = require('path');
const { sendToAllowlist } = require('./telegram');

const PYTHON = process.env.PYTHON_BIN || 'python3';
const ASK_SCRIPT = path.join(__dirname, 'meeting-brief-search.py');

function osascript(script, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

/**
 * Returns the next upcoming Calendar event (within the next 24h) as
 * `{ title, start, end, location, attendees: [name…], notes }`, or null.
 */
async function getNextEvent() {
  const script = `
    set out to ""
    set now to current date
    set horizon to now + 24 * hours
    tell application "Calendar"
      repeat with c in calendars
        repeat with e in (events of c whose start date ≥ now and start date < horizon)
          set sd to start date of e
          set ed to end date of e
          set ttl to summary of e
          try
            set loc to location of e
          on error
            set loc to ""
          end try
          try
            set nts to description of e
          on error
            set nts to ""
          end try
          set out to out & ttl & "|||" & (sd as string) & "|||" & (ed as string) & "|||" & loc & "|||" & nts & linefeed
        end repeat
      end repeat
    end tell
    return out
  `;
  const raw = await osascript(script, 15000).catch(() => '');
  const lines = raw.split('\n').filter(Boolean);
  if (!lines.length) return null;

  // Pick the earliest by start date.
  const events = lines.map((l) => {
    const [title, start, end, location, notes] = l.split('|||');
    return { title, start, end, location, notes, startDate: new Date(start) };
  }).filter((e) => !isNaN(e.startDate.getTime()));
  if (!events.length) return null;
  events.sort((a, b) => a.startDate - b.startDate);
  const ev = events[0];

  // Try to extract attendee names from the notes/description (best effort).
  ev.attendees = extractAttendees(ev.notes || '');
  return ev;
}

function extractAttendees(text) {
  // Pull names that look like "Ad Soyad" sequences and email-prefix names.
  const names = new Set();
  const nameRegex = /\b([A-ZĞÜŞİÖÇ][a-zğüşıöç]{2,})\s+([A-ZĞÜŞİÖÇ][a-zğüşıöç]{2,})\b/g;
  let m;
  while ((m = nameRegex.exec(text)) !== null) names.add(`${m[1]} ${m[2]}`);
  const emailRegex = /([a-zA-Z0-9._-]+)@[a-zA-Z0-9.-]+/g;
  while ((m = emailRegex.exec(text)) !== null) {
    const local = m[1].replace(/[._-]+/g, ' ').trim();
    if (local.length > 2) names.add(local);
  }
  return [...names].slice(0, 6);
}

function runKnowledgeSearch({ query, source = '', since = '', topK = 5 }) {
  return new Promise((resolve) => {
    const args = JSON.stringify({ query, source, since, top_k: topK });
    const proc = spawn(PYTHON, [ASK_SCRIPT, args], {
      env: { ...process.env, PYTHONPATH: process.env.OPENJARVIS_SRC || '' },
    });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', () => {
      try { resolve(JSON.parse(out || '[]')); }
      catch { resolve([]); }
    });
    setTimeout(() => { try { proc.kill(); } catch {} resolve([]); }, 12_000);
  });
}

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString();
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function buildBrief() {
  const ev = await getNextEvent();
  if (!ev) return { text: 'Önümüzdeki 24 saat içinde planlı toplantı yok efendim.', meta: null };

  const since = isoDaysAgo(30);
  const queries = [];

  // 1) Topic-driven: meeting title across all connectors
  queries.push(runKnowledgeSearch({ query: ev.title, since, topK: 4 }));

  // 2) Granola past meetings about same topic (high signal)
  queries.push(runKnowledgeSearch({ query: ev.title, source: 'granola', since: isoDaysAgo(120), topK: 3 }));

  // 3) Per-attendee mentions (cap at 4 to avoid blowing up)
  for (const name of (ev.attendees || []).slice(0, 4)) {
    queries.push(runKnowledgeSearch({ query: name, since, topK: 3 }));
  }

  const results = await Promise.all(queries);
  const [topicHits, granolaHits, ...attendeeHits] = results;

  const lines = [];
  const startStr = ev.startDate.toLocaleString('tr-TR', {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
  lines.push(`📋 <b>Toplantı Brief — ${escapeHtml(ev.title)}</b>`);
  lines.push(`🕐 ${escapeHtml(startStr)}${ev.location ? ` · 📍 ${escapeHtml(ev.location)}` : ''}`);

  if ((ev.attendees || []).length) {
    lines.push(`👥 ${ev.attendees.map(escapeHtml).join(', ')}`);
  }

  if (granolaHits.length) {
    lines.push(`\n🎙 <b>Önceki toplantı notları</b>`);
    granolaHits.slice(0, 3).forEach((h) => {
      lines.push(`  • ${escapeHtml(h.title || h.snippet?.slice(0, 80) || 'note')}`);
    });
  }

  if (topicHits.length) {
    lines.push(`\n🔍 <b>Bağlam (son 30 gün)</b>`);
    topicHits.slice(0, 4).forEach((h) => {
      const src = h.source ? `[${h.source}]` : '';
      lines.push(`  • ${src} ${escapeHtml((h.title || h.snippet || '').slice(0, 100))}`);
    });
  }

  attendeeHits.forEach((hits, i) => {
    const name = ev.attendees[i];
    if (!hits.length || !name) return;
    lines.push(`\n👤 <b>${escapeHtml(name)} (son 30 gün)</b>`);
    hits.slice(0, 3).forEach((h) => {
      const src = h.source ? `[${h.source}]` : '';
      lines.push(`  • ${src} ${escapeHtml((h.title || h.snippet || '').slice(0, 100))}`);
    });
  });

  return { text: lines.join('\n'), meta: { event: ev.title, hits: results.flat().length } };
}

async function sendNow() {
  const { text, meta } = await buildBrief();
  const r = await sendToAllowlist(text);
  return { ok: r.ok, error: r.error, preview: text.slice(0, 200), meta };
}

function handleHttp(req, res) {
  if (req.method === 'POST' && req.url === '/api/meeting-brief/send') {
    sendNow().then((r) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    }).catch((e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return true;
  }
  if (req.method === 'GET' && req.url === '/api/meeting-brief/preview') {
    buildBrief().then(({ text, meta }) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text, meta }));
    }).catch((e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return true;
  }
  return false;
}

function shouldHandle(url) {
  return url.startsWith('/api/meeting-brief');
}

// Auto-trigger: every 60s, check if next event starts in 14-16 minutes
// (tight window so we fire exactly once per meeting). Sent state persisted
// in-memory; restart resets.
const _sentFor = new Set();

async function watchTick() {
  try {
    const ev = await getNextEvent();
    if (!ev) return;
    const ms = ev.startDate.getTime() - Date.now();
    const minutes = ms / 60_000;
    const key = `${ev.title}@${ev.startDate.toISOString()}`;
    if (minutes >= 13 && minutes <= 16 && !_sentFor.has(key)) {
      _sentFor.add(key);
      const r = await sendNow();
      console.log('[meeting-brief] auto-sent:', key, 'ok=', r.ok);
    }
  } catch (e) {
    console.warn('[meeting-brief] tick error:', e.message);
  }
}

let _watchTimer = null;
function start() {
  if (_watchTimer) clearInterval(_watchTimer);
  _watchTimer = setInterval(() => watchTick().catch(() => {}), 60_000);
  console.log('[meeting-brief] watcher started (15min pre-meeting trigger)');
}

module.exports = { handleHttp, shouldHandle, sendNow, buildBrief, start };
