/**
 * Yahoo Finance proxy — server-side fetch to bypass browser CORS.
 *   GET /api/markets/indices?symbols=^GSPC,^IXIC,XU100.IS,...
 * Yahoo's v7/finance/quote occasionally rate-limits; fallback to v8/finance/chart.
 */
const https = require('https');

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        ...headers,
      },
      timeout: 6000,
    }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const body = Buffer.concat(cs).toString('utf-8');
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

async function fetchOne(symbol) {
  // v8 chart endpoint: returns last close + previous close → derive %
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  try {
    const j = await fetchJson(url);
    const r = j.chart?.result?.[0];
    if (!r) return null;
    const meta = r.meta || {};
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose;
    if (typeof price !== 'number' || typeof prev !== 'number' || prev === 0) return null;
    return { price, change: ((price - prev) / prev) * 100 };
  } catch { return null; }
}

async function indicesHandler(req, res) {
  const u = new URL(req.url, 'http://x');
  const symbols = (u.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!symbols.length) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'symbols required' }));
    return;
  }
  const results = await Promise.all(symbols.map(fetchOne));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ results: results.map((r) => r || { price: 0, change: 0 }) }));
}

async function intradayHandler(req, res) {
  const u = new URL(req.url, 'http://x');
  const symbol = (u.searchParams.get('symbol') || '').trim();
  const interval = (u.searchParams.get('interval') || '5m').trim(); // 1m,5m,15m,30m,60m
  const range = (u.searchParams.get('range') || '1d').trim();       // 1d,5d,1mo
  if (!symbol) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'symbol required' }));
    return;
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
  try {
    const j = await fetchJson(url);
    const r = j.chart?.result?.[0];
    if (!r) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no data' }));
      return;
    }
    const ts = r.timestamp || [];
    const close = r.indicators?.quote?.[0]?.close || [];
    const points = ts.map((t, i) => ({ t: t * 1000, v: close[i] })).filter((p) => p.v != null);
    const meta = r.meta || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      symbol,
      interval,
      range,
      currency: meta.currency,
      previous_close: meta.chartPreviousClose,
      regular_price: meta.regularMarketPrice,
      points,
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleHttp(req, res) {
  if (req.url.startsWith('/api/markets/indices') && req.method === 'GET') {
    return indicesHandler(req, res);
  }
  if (req.url.startsWith('/api/markets/intraday') && req.method === 'GET') {
    return intradayHandler(req, res);
  }
  return null;
}

function shouldHandle(url) {
  return url.startsWith('/api/markets/');
}

module.exports = { handleHttp, shouldHandle };
