/**
 * Kronos forecast aracı — yerel FastAPI servisini (127.0.0.1:8023) çağırır.
 * Olasılıksal sinyal; kesin tahmin değil (uyarı eklenir).
 */
const http = require('http');

const MAP = {
  dolar: ['forex', 'USDTRY=X', 'Dolar/TL'], usd: ['forex', 'USDTRY=X', 'Dolar/TL'], usdtry: ['forex', 'USDTRY=X', 'Dolar/TL'],
  euro: ['forex', 'EURTRY=X', 'Euro/TL'], eur: ['forex', 'EURTRY=X', 'Euro/TL'], eurtry: ['forex', 'EURTRY=X', 'Euro/TL'],
  altin: ['forex', 'GC=F', 'Ons Altın'], altın: ['forex', 'GC=F', 'Ons Altın'], gold: ['forex', 'GC=F', 'Ons Altın'], ons: ['forex', 'GC=F', 'Ons Altın'],
  bitcoin: ['crypto', 'BTCUSDT', 'Bitcoin'], btc: ['crypto', 'BTCUSDT', 'Bitcoin'],
  ethereum: ['crypto', 'ETHUSDT', 'Ethereum'], eth: ['crypto', 'ETHUSDT', 'Ethereum'],
  sterlin: ['forex', 'GBPTRY=X', 'Sterlin/TL'], gbp: ['forex', 'GBPTRY=X', 'Sterlin/TL'], pound: ['forex', 'GBPTRY=X', 'Sterlin/TL'],
  gumus: ['forex', 'SI=F', 'Gümüş'], 'gümüş': ['forex', 'SI=F', 'Gümüş'], silver: ['forex', 'SI=F', 'Gümüş'],
  bnb: ['crypto', 'BNBUSDT', 'BNB'], solana: ['crypto', 'SOLUSDT', 'Solana'], sol: ['crypto', 'SOLUSDT', 'Solana'],
  xrp: ['crypto', 'XRPUSDT', 'XRP'], ripple: ['crypto', 'XRPUSDT', 'XRP'],
  bist: ['index', 'XU100.IS', 'BIST 100'], bist100: ['index', 'XU100.IS', 'BIST 100'], 'bist 100': ['index', 'XU100.IS', 'BIST 100'], xu100: ['index', 'XU100.IS', 'BIST 100'], borsa: ['index', 'XU100.IS', 'BIST 100'],
  nasdaq: ['index', '^IXIC', 'Nasdaq'], dow: ['index', '^DJI', 'Dow Jones'], dowjones: ['index', '^DJI', 'Dow Jones'], 'dow jones': ['index', '^DJI', 'Dow Jones'],
  sp500: ['index', '^GSPC', 'S&P 500'], sp: ['index', '^GSPC', 'S&P 500'], snp: ['index', '^GSPC', 'S&P 500'], 's&p': ['index', '^GSPC', 'S&P 500'], 's&p500': ['index', '^GSPC', 'S&P 500'],
  nyse: ['index', '^NYA', 'NYSE'], dax: ['index', '^GDAXI', 'DAX'], nikkei: ['index', '^N225', 'Nikkei'], ftse: ['index', '^FTSE', 'FTSE 100'],
};

function callService(body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: 8023, path: '/forecast', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 90_000 },
      (res) => { const cs = []; res.on('data', (c) => cs.push(c)); res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(cs).toString())); } catch { resolve({ ok: false, error: 'parse' }); } }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout (model meşgul)' }); });
    req.write(payload); req.end();
  });
}

const TOOLS = [
  { name: 'market_forecast', description: 'Bir varlığın gelecek fiyat YÖNÜNÜ Kronos AI modeliyle olasılıksal tahmin et ("dolar bu hafta ne olur", "bitcoin tahmini"). asset: dolar, euro, altin, bitcoin, ethereum, bnb, solana, xrp (veya kripto sembolü). days: kaç gün ilerisi (varsayılan 5 = bu hafta). KESİN değil, olasılıksal.',
    input_schema: { type: 'object', properties: { asset: { type: 'string' }, days: { type: 'number' } }, required: ['asset'] } },
];

const TOOL_IMPL = {
  market_forecast: async ({ asset, days }) => {
    const key = String(asset || '').toLowerCase().trim().replace(/\s+/g, '');
    let m = MAP[key];
    if (!m) {
      if (/^[a-z]{2,6}$/.test(key)) m = ['crypto', key.toUpperCase() + 'USDT', key.toUpperCase()];
      else return `Bilinmeyen varlık: ${asset}. Örnek: dolar, euro, altin, bitcoin, ethereum.`;
    }
    const [market, symbol, label] = m;
    const pred_len = Math.max(1, Math.min(days || 5, 14));
    const r = await callService({ market, symbol, interval: '1d', lookback: 120, pred_len, samples: 8 });
    if (!r.ok) {
      const e = String(r.error || '');
      if (/ECONNREFUSED|timeout|ECONNRESET|socket hang/i.test(e)) return 'Kronos şu an erişilemiyor Patron — MacBook kapalı veya servis çalışmıyor olabilir. Mac açıkken tekrar dener misin?';
      return `Tahmin alınamadı (${e || 'servis hatası'}).`;
    }
    const fmt = (n) => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: market === 'forex' ? 4 : 2 });
    return [
      `🔮 *Kronos Tahmini — ${label}* (${pred_len} günlük)`,
      `• Şu an: ${fmt(r.last_close)}`,
      `• Beklenen: ${fmt(r.expected_close)} (${r.direction}, %${r.expected_change_pct})`,
      `• Yükseliş olasılığı: %${Math.round(r.prob_up * 100)}`,
      `• Olası aralık: ${fmt(r.range_p10_p90[0])} – ${fmt(r.range_p10_p90[1])}`,
      ``,
      `⚠️ _Kesin tahmin DEĞİL — Kronos AI'nın olasılıksal sinyali (~%58-65 isabet; döviz/jeopolitik şoklarda güvenilmez). Yatırım tavsiyesi değildir._`,
    ].join('\n');
  },
};

module.exports = { TOOLS, TOOL_IMPL };
