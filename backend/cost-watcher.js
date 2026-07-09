/**
 * Cost watcher — günlük API harcamasını izler; %80 ve %100 eşiklerinde
 * Telegram'a tek seferlik uyarı yollar. Eşik durumu günlük resetlenir.
 *
 * Polls agent /metrics every 60s.
 */
const http = require('http');
const { sendToAllowlist } = require('./telegram');

let timer = null;
let lastDay = '';
let warned80 = false;
let warned100 = false;

function fetchMetrics() {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 8767, path: '/metrics', timeout: 3000 }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(cs).toString())); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null)).on('timeout', function () { this.destroy(); resolve(null); });
  });
}

function today() { return new Date().toISOString().slice(0, 10); }

async function tick() {
  const m = await fetchMetrics();
  if (!m) return;
  const day = today();
  if (day !== lastDay) {
    lastDay = day;
    warned80 = false;
    warned100 = false;
  }
  const spent = Number(m.spend_usd_today || 0);
  const cap = Number(m.daily_cap_usd || 0);
  if (cap <= 0) return;
  const pct = spent / cap;

  if (!warned100 && pct >= 1.0) {
    warned100 = true;
    try {
      await sendToAllowlist(
        `⚠ <b>Günlük API cap aşıldı</b>\n` +
        `Harcama: $${spent.toFixed(4)} / $${cap.toFixed(2)}\n` +
        `Ucuz/free fallback model'e geçildi (LLM_FREE).`,
      );
    } catch (e) { console.warn('[cost] tg100:', e.message); }
    return;
  }
  if (!warned80 && pct >= 0.8) {
    warned80 = true;
    try {
      await sendToAllowlist(
        `📊 Günlük API cap'inin %${Math.round(pct * 100)}'ine ulaşıldı.\n` +
        `Harcama: $${spent.toFixed(4)} / $${cap.toFixed(2)}`,
      );
    } catch (e) { console.warn('[cost] tg80:', e.message); }
  }
}

function start() {
  lastDay = today();
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick().catch(() => {}), 60_000);
  console.log('[cost] watcher started');
}

function shouldHandle(url) { return url.startsWith('/api/cost/'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/api/cost/now') {
    const m = await fetchMetrics();
    if (!m) { res.writeHead(503); res.end(JSON.stringify({ ok: false, error: 'agent metrics unreachable' })); return; }
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      day: today(),
      spend_usd_today: Number(m.spend_usd_today || 0),
      daily_cap_usd: Number(m.daily_cap_usd || 0),
      tokens_in: m.tokens_in || 0,
      tokens_out: m.tokens_out || 0,
      by_model: m.by_model || {},
      top_prompts: m.top_prompts || [],
      week: m.week || [],
      raw: m,
    }));
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { start, shouldHandle, handleHttp };
