/**
 * Calendar AI prep — for the next upcoming meeting, get a 3-sentence brief.
 *
 *   GET /api/calendar-prep/next  → {event, prep, who?, last_messages?}
 *
 * Pipeline:
 *   1. Fetch next meeting from /api/google/calendar/upcoming
 *   2. Extract attendees + summary
 *   3. (Optionally) search recent emails from attendees for context
 *   4. Send to Claude (agent :8767, abonelik SDK) → 3-sentence prep brief
 */
const http = require('http');
const llm = require('./llm-sdk');

function getJsonLocal(path) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path, timeout: 5000 }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(cs).toString())); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null)).on('timeout', function () { this.destroy(); resolve(null); });
  });
}

async function buildPrep() {
  const cal = await getJsonLocal('/api/google/calendar/upcoming?max=3');
  if (!cal || !cal.ok || !cal.events?.length) {
    return { ok: false, error: 'no upcoming events' };
  }
  const ev = cal.events[0];
  const attendees = (ev.attendees || []).map((a) => a.email).filter(Boolean);
  const lang = (process.env.XJARVIS_LANG || 'tr').toLowerCase();

  const promptTr = `Önümüzdeki toplantı için 3 cümlelik hazırlık brief'i yaz:
Toplantı: ${ev.summary || 'isimsiz'}
Başlangıç: ${ev.start_time || ev.start}
Katılımcılar: ${attendees.join(', ') || '—'}
Açıklama: ${(ev.description || '').slice(0, 500)}

3 cümle:
1. Konu/amaç (bir cümle)
2. Bu toplantıdan önce hatırlatılması gereken kritik nokta (bir cümle)
3. Önerilen ilk söz / açılış cümlesi (bir cümle)

Türkçe, doğrudan, "patron" hitabı, fazla nezaket dolgusu yok.`;
  const promptEn = `Write a 3-sentence prep brief for the upcoming meeting:
Meeting: ${ev.summary || 'untitled'}
Start: ${ev.start_time || ev.start}
Attendees: ${attendees.join(', ') || '—'}
Description: ${(ev.description || '').slice(0, 500)}

Three sentences:
1. Topic/purpose (one sentence)
2. Critical thing to remember before this meeting (one sentence)
3. Suggested opening line (one sentence)

English, direct, "sir" address, no filler.`;

  const r = await llm.complete({ prompt: lang === 'en' ? promptEn : promptTr });
  if (!r.ok) return { ok: false, error: r.error || 'llm error', event: ev };
  return { ok: true, event: ev, prep: r.text, attendees };
}

function shouldHandle(url) { return url.startsWith('/api/calendar-prep/'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/calendar-prep/next' && req.method === 'GET') {
    const r = await buildPrep();
    res.writeHead(r.ok ? 200 : 400);
    res.end(JSON.stringify(r));
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { handleHttp, shouldHandle, buildPrep };
