/**
 * Canlı veri kaynakları — hepsi API-key GEREKTİRMEZ, hepsi GÜNCEL veri döner.
 * Eski/arşiv fiyat dönmemesi için her çağrı anlık endpoint'lere gider.
 *
 *  - getMarkets()  → endeksler (Yahoo) + döviz/altın (truncgil) + kripto (CoinGecko)
 *  - getNews()     → yapay zeka + teknoloji haberleri (RSS, global)
 *  - getPrayer()   → Balıkesir namaz vakitleri + hicri tarih (Aladhan)
 *
 * Tüm fetch'ler kısa timeout + tek seferlik; bir kaynak düşerse diğerleri
 * çalışmaya devam eder (Promise.allSettled).
 */
const https = require('https');

function fetchText(url, { timeout = 8000, headers = {}, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/605.1',
        Accept: '*/*',
        ...headers,
      },
      timeout,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(fetchText(next, { timeout, headers, redirects: redirects - 1 }));
      }
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const body = Buffer.concat(cs).toString('utf-8');
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 120)}`));
        resolve(body);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

const fetchJson = (url, opts) => fetchText(url, opts).then((t) => JSON.parse(t));

// --- 1) Endeksler (Yahoo Finance, anlık) ------------------------------------
const INDEX_SYMBOLS = [
  { sym: 'XU100.IS', name: 'BIST 100' },
  { sym: '^GSPC', name: 'S&P 500' },
  { sym: '^IXIC', name: 'Nasdaq' },
  { sym: '^DJI', name: 'Dow Jones' },
  { sym: '^N225', name: 'Nikkei 225 (Japonya)' },
  { sym: '^HSI', name: 'Hang Seng (Hong Kong)' },
  { sym: '000001.SS', name: 'Shanghai (Çin)' },
  { sym: '^GDAXI', name: 'DAX (Almanya)' },
  { sym: '^FTSE', name: 'FTSE 100 (İngiltere)' },
  { sym: '^FCHI', name: 'CAC 40 (Fransa)' },
];

async function fetchIndex({ sym, name, alt }) {
  const tryOne = async (s) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=2d`;
    const j = await fetchJson(url, { timeout: 6000 });
    const m = j?.chart?.result?.[0]?.meta;
    if (!m || typeof m.regularMarketPrice !== 'number') throw new Error('no price');
    const prev = m.chartPreviousClose ?? m.previousClose ?? m.regularMarketPreviousClose;
    const pct = prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null;
    return { name, price: m.regularMarketPrice, pct };
  };
  try { return await tryOne(sym); }
  catch (e) { if (alt) { try { return await tryOne(alt); } catch {} } return { name, error: true }; }
}

async function getIndices() {
  const out = await Promise.allSettled(INDEX_SYMBOLS.map(fetchIndex));
  return out.map((r) => (r.status === 'fulfilled' ? r.value : { error: true }));
}

// --- 2) Döviz + altın (truncgil, anlık, TR) ---------------------------------
function parseTr(num) {
  // "45,9701" / "6.408,30" / "$4.329,21" → Number
  if (typeof num !== 'string') return Number(num);
  return Number(num.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
}

async function getForexGold() {
  const j = await fetchJson('https://finans.truncgil.com/today.json', { timeout: 7000 });
  const grab = (k) => {
    const o = j[k];
    if (!o) return null;
    return { buy: parseTr(o['Alış'] ?? o.Alis), sell: parseTr(o['Satış'] ?? o.Satis), change: o['Değişim'] ?? o.Degisim ?? '' };
  };
  return {
    updated: j.Update_Date || '',
    usd: grab('USD'),
    eur: grab('EUR'),
    gramAltin: grab('gram-altin'),
    onsAltin: grab('ons'),
  };
}

// --- 3) Kripto (CoinGecko, anlık, top 5) ------------------------------------
const COINS = [
  { id: 'bitcoin', sym: 'BTC' },
  { id: 'ethereum', sym: 'ETH' },
  { id: 'binancecoin', sym: 'BNB' },
  { id: 'solana', sym: 'SOL' },
  { id: 'ripple', sym: 'XRP' },
];

async function getCrypto() {
  const ids = COINS.map((c) => c.id).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const j = await fetchJson(url, { timeout: 7000 });
  return COINS.map((c) => ({
    sym: c.sym,
    price: j[c.id]?.usd ?? null,
    pct: j[c.id]?.usd_24h_change ?? null,
  }));
}

async function getMarkets() {
  const [indices, forex, crypto] = await Promise.all([
    getIndices().catch(() => []),
    getForexGold().catch(() => null),
    getCrypto().catch(() => []),
  ]);
  return { indices, forex, crypto };
}

// --- 4) Haberler — yapay zeka + teknoloji (RSS, global, key-free) -----------
const NEWS_FEEDS = [
  'https://techcrunch.com/category/artificial-intelligence/feed/',
  'https://www.theverge.com/rss/index.xml',
  'https://feeds.arstechnica.com/arstechnica/technology-lab',
  'https://venturebeat.com/category/ai/feed/',
  'https://www.wired.com/feed/category/business/artificial-intelligence/latest/rss',
];

const AI_TECH_RE = /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|llm|gpt|openai|anthropic|claude|gemini|deepmind|nvidia|chip|semiconductor|robot|neural|model|startup|software|cloud|quantum|data center|agent)\b/i;

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#8217;/g, '’').replace(/&#8230;/g, '…').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseRssTitles(xml, limit = 6) {
  const items = [];
  // Hem <item> (RSS) hem <entry> (Atom) destekle
  const blocks = xml.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  for (const b of blocks) {
    const tm = b.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!tm) continue;
    let title = tm[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    title = decodeEntities(title).replace(/\s+/g, ' ');
    if (title) items.push(title);
    if (items.length >= limit) break;
  }
  return items;
}

async function getNews(limit = 6) {
  const results = await Promise.allSettled(
    NEWS_FEEDS.map((u) => fetchText(u, { timeout: 7000 })),
  );
  const seen = new Set();
  const headlines = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const t of parseRssTitles(r.value, 8)) {
      const key = t.toLowerCase().slice(0, 40);
      if (seen.has(key)) continue;
      if (!AI_TECH_RE.test(t)) continue;
      seen.add(key);
      headlines.push(t);
      if (headlines.length >= limit) break;
    }
    if (headlines.length >= limit) break;
  }
  return headlines;
}

// --- 5) Namaz vakitleri + hicri (Aladhan, Balıkesir) ------------------------
const BALIKESIR = { lat: 41.0082, lng: 28.9784 };

async function getPrayer() {
  const url = `https://api.aladhan.com/v1/timings?latitude=${BALIKESIR.lat}&longitude=${BALIKESIR.lng}&method=13`;
  const j = await fetchJson(url, { timeout: 12000 });
  const d = j?.data;
  if (!d) throw new Error('aladhan empty');
  const t = d.timings;
  const clean = (x) => (x || '').split(' ')[0]; // "13:12 (+03)" → "13:12"
  return {
    timings: {
      imsak: clean(t.Fajr),
      gunes: clean(t.Sunrise),
      ogle: clean(t.Dhuhr),
      ikindi: clean(t.Asr),
      aksam: clean(t.Maghrib),
      yatsi: clean(t.Isha),
    },
    hijri: {
      day: d.date?.hijri?.day,
      monthNumber: d.date?.hijri?.month?.number,
      monthName: d.date?.hijri?.month?.en,
      year: d.date?.hijri?.year,
      weekday: d.date?.hijri?.weekday?.en,
      holidays: d.date?.hijri?.holidays || [],
    },
    gregorian: d.date?.readable || '',
  };
}

module.exports = { getMarkets, getIndices, getForexGold, getCrypto, getNews, getPrayer };
