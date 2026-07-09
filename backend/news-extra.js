/**
 * Ek haber + finans verisi endpoint'leri.
 *   GET /api/news/headlines        → NewsAPI.org top headlines (TR)
 *   GET /api/news/crypto           → Cryptopanic son posts
 *   GET /api/markets/quote?sym=X   → Finnhub spot quote
 *
 * Anahtarlar .env'de: NEWSAPI_KEY, CRYPTOPANIC_API_KEY, FINNHUB_API_KEY
 * Anahtar yoksa endpoint {ok:false, error:'no key'} döner.
 */
const https = require('https');

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'XJarvis/1.0', ...headers }, timeout: 8000 }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const body = Buffer.concat(cs).toString();
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

async function headlinesHandler(req, res) {
  const key = process.env.NEWSAPI_KEY;
  if (!key) { res.writeHead(503); res.end(JSON.stringify({ ok: false, error: 'NEWSAPI_KEY missing' })); return; }
  const u = new URL(req.url, 'http://x');
  const country = u.searchParams.get('country') || 'tr';
  // NewsAPI free tier `country=tr` boş döndürüyor. `everything` endpoint'iyle
  // Türkçe sorgu daha güvenilir.
  const lang = u.searchParams.get('lang') || (country === 'tr' ? 'tr' : 'en');
  const qOverride = u.searchParams.get('q');
  const q = qOverride || (country === 'tr' ? 'Türkiye OR İstanbul OR ekonomi OR siyaset' : 'world');
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=${lang}&sortBy=publishedAt&pageSize=15&apiKey=${key}`;
  try {
    const j = await fetchJson(url);
    const items = (j.articles || []).map((a) => ({
      title: a.title, source: a.source?.name, url: a.url, published: a.publishedAt,
    }));
    if (items.length === 0) throw new Error('empty');
    res.writeHead(200); res.end(JSON.stringify({ ok: true, count: items.length, items, src: 'newsapi' }));
  } catch (e) {
    // Fallback: Google News RSS (no key required)
    try {
      const hl = lang === 'tr' ? 'tr' : 'en-US';
      const gl = lang === 'tr' ? 'TR' : 'US';
      const ceid = lang === 'tr' ? 'TR:tr' : 'US:en';
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
      const xml = await new Promise((resolve, reject) => {
        https.get(rssUrl, { headers: { 'User-Agent': 'XJarvis/1.0' }, timeout: 8000 }, (res) => {
          const cs = [];
          res.on('data', (c) => cs.push(c));
          res.on('end', () => resolve(Buffer.concat(cs).toString()));
        }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
      });
      const items = [];
      const re = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = re.exec(xml)) && items.length < 15) {
        const block = m[1];
        const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
        const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
        const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
        const src = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || 'Google News';
        items.push({ title: title.replace(/<!\[CDATA\[|\]\]>/g, ''), source: src, url: link, published: pub });
      }
      res.writeHead(200); res.end(JSON.stringify({ ok: true, count: items.length, items, src: 'gnews', warn: e.message }));
    } catch (e2) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e2.message }));
    }
  }
}

async function quoteHandler(req, res) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) { res.writeHead(503); res.end(JSON.stringify({ ok: false, error: 'FINNHUB_API_KEY missing' })); return; }
  const u = new URL(req.url, 'http://x');
  const sym = (u.searchParams.get('sym') || '').toUpperCase().slice(0, 16);
  if (!sym) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'sym required' })); return; }
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`;
  try {
    const j = await fetchJson(url);
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true, symbol: sym,
      price: j.c, change: j.d, change_pct: j.dp,
      open: j.o, high: j.h, low: j.l, prev_close: j.pc,
    }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

function shouldHandle(url) {
  return (
    url.startsWith('/api/news/headlines') ||
    url.startsWith('/api/markets/quote')
  );
}

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/news/headlines')) return headlinesHandler(req, res);
  if (req.url.startsWith('/api/markets/quote'))  return quoteHandler(req, res);
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { shouldHandle, handleHttp };
