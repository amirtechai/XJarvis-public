/**
 * WHOOP bridge — backend forward to api.prod.whoop.com.
 *   GET /api/whoop/summary  → { recovery, hrv, rhr, sleep_perf, strain }
 * Caches for 5min.
 */
const https = require('https');

let cache = null;
let cacheAt = 0;
const TTL = 5 * 60 * 1000;

function getJson(url, headers) {
  return new Promise((resolve) => {
    https.get(url, { headers, timeout: 10000 }, (res) => {
      const cs = []; res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(cs).toString()) }); }
        catch { resolve({ status: 500, body: null }); }
      });
    }).on('error', () => resolve({ status: 0, body: null }))
      .on('timeout', function () { this.destroy(); resolve({ status: 0, body: null }); });
  });
}

async function fetchSummary() {
  const token = (process.env.WHOOP_ACCESS_TOKEN || '').trim();
  if (!token) return { error: 'WHOOP_ACCESS_TOKEN missing' };
  const headers = { Authorization: `Bearer ${token}` };
  const end = new Date().toISOString();
  const start = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const qs = `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const [rec, slp] = await Promise.all([
    getJson(`https://api.prod.whoop.com/developer/v1/recovery${qs}`, headers),
    getJson(`https://api.prod.whoop.com/developer/v1/activity/sleep${qs}`, headers),
  ]);
  const r = rec.body?.records?.[0]?.score || {};
  const s = slp.body?.records?.[0]?.score || {};
  return {
    recovery: r.recovery_score ?? null,
    hrv: r.hrv_rmssd_milli ?? null,
    rhr: r.resting_heart_rate ?? null,
    strain: r.strain ?? null,
    sleep_perf: s.sleep_performance_percentage ?? null,
    sleep_eff: s.sleep_efficiency_percentage ?? null,
    cached_at: Date.now() / 1000,
  };
}

async function summaryHandler(req, res) {
  if (cache && Date.now() - cacheAt < TTL) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cache));
    return;
  }
  const data = await fetchSummary();
  cache = data;
  cacheAt = Date.now();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleHttp(req, res) {
  if (req.url === '/api/whoop/summary' && req.method === 'GET') return summaryHandler(req, res);
  return null;
}

function shouldHandle(url) { return url.startsWith('/api/whoop/'); }

module.exports = { handleHttp, shouldHandle };
