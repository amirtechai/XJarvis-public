/**
 * Cinematic briefing — pre-baked composer for /briefing page.
 *   GET /api/briefing/now → {greeting, sections: [{label, items, source}]}
 *
 * Pulls from existing services: morning-brief, news-feed, finance, calendar.
 * Doesn't re-run anything heavy; just composes the latest available data.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function shouldHandle(url) { return url.startsWith('/api/briefing'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }

  const now = new Date();
  const h = now.getHours();
  const lang = (process.env.XJARVIS_LANG || 'tr').toLowerCase();
  const greeting = lang === 'en'
    ? (h < 12 ? 'Good morning, sir.' : h < 18 ? 'Good afternoon, sir.' : 'Good evening, sir.')
    : (h < 12 ? 'Günaydın patron.' : h < 18 ? 'İyi günler patron.' : 'İyi akşamlar patron.');

  const dir = path.join(os.homedir(), '.config', 'xjarvis');
  const morning = (() => {
    const txt = path.join(dir, 'morning-brief-last.txt');
    try { return fs.readFileSync(txt, 'utf-8').trim(); } catch { return ''; }
  })();
  const insights = (() => {
    const txt = path.join(dir, 'insights-last.txt');
    try { return fs.readFileSync(txt, 'utf-8').trim(); } catch { return ''; }
  })();

  const sections = [];
  if (morning) sections.push({ label: lang === 'en' ? 'Morning brief' : 'Sabah brifingi', body: morning, source: 'morning-brief' });
  if (insights) sections.push({ label: lang === 'en' ? 'Daily insights' : 'Günün analizi', body: insights, source: 'insights' });

  // Calendar today (if google-services exposes a cached file)
  const calCache = path.join(dir, 'calendar-today.json');
  const cal = readJson(calCache);
  if (cal && Array.isArray(cal.items) && cal.items.length) {
    sections.push({
      label: lang === 'en' ? 'Today\'s schedule' : 'Bugünkü program',
      items: cal.items.slice(0, 6).map((e) => ({
        time: e.start_time || '',
        title: e.title || e.summary || 'Event',
      })),
      source: 'calendar',
    });
  }

  res.writeHead(200);
  res.end(JSON.stringify({
    ok: true,
    greeting,
    timestamp: now.toISOString(),
    sections,
  }));
}

module.exports = { handleHttp, shouldHandle };
