/**
 * Günlük brifing — piyasa + haber + namaz + ayet + hadis + motivasyon.
 * Telegram komutlarının ve günlük otomatik push'un metnini üretir.
 *
 * Config: ~/.config/xjarvis/daily-brief.json { enabled, time:"HH:MM" }
 *
 * HTTP:
 *   GET  /api/daily/state    → { enabled, time, last_sent }
 *   POST /api/daily/save     → { enabled?, time? }
 *   GET  /api/daily/preview  → { text }   (tam brifing metni)
 *   POST /api/daily/send     → şimdi allowlist'e gönder
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const src = require('./daily-sources');
const content = require('./daily-content');
const quran = require('./quran-api');
const mentor = require('./mentor-quotes');
const advisor = require('./advisor-content');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'daily-brief.json');
const STATE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'daily-brief-last.txt');

let config = { enabled: false, time: '08:00' };
let timer = null;

function loadConfig() {
  try { if (fs.existsSync(CONFIG_PATH)) Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))); }
  catch (e) { console.warn('[daily] load:', e.message); }
}
function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
function lastSentDay() { try { return fs.readFileSync(STATE_PATH, 'utf-8').trim(); } catch { return ''; } }
function markSent(day) { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, day); }

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const fmt = (n) => (typeof n === 'number' && isFinite(n) ? nf.format(n) : '—');
const arrow = (pct) => (pct == null ? '' : pct > 0 ? '🟢▲' : pct < 0 ? '🔴▼' : '⚪️');
const pctStr = (pct) => (pct == null ? '' : `${arrow(pct)} ${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`);

// --- Composer'lar ------------------------------------------------------------

async function composeMarkets() {
  const m = await src.getMarkets();
  const L = ['📊 *Piyasalar*', ''];
  L.push('💱 *Döviz & Altın*');
  if (m.forex) {
    const f = m.forex;
    if (f.usd) L.push(`• Dolar/TL: ${fmt(f.usd.sell)} ₺ (${f.usd.change})`);
    if (f.eur) L.push(`• Euro/TL: ${fmt(f.eur.sell)} ₺ (${f.eur.change})`);
    if (f.gramAltin) L.push(`• Gram Altın: ${fmt(f.gramAltin.sell)} ₺ (${f.gramAltin.change})`);
    if (f.onsAltin && f.onsAltin.sell) L.push(`• Ons Altın: $${fmt(f.onsAltin.sell)} (${f.onsAltin.change})`);
  } else L.push('• (döviz verisi alınamadı)');
  L.push('', '📈 *Borsalar*');
  for (const i of m.indices) {
    if (i.error) continue;
    L.push(`• ${i.name}: ${fmt(i.price)} ${pctStr(i.pct)}`.trim());
  }
  L.push('', '🪙 *Kripto (Top 5)*');
  for (const c of m.crypto) {
    if (c.price == null) continue;
    L.push(`• ${c.sym}: $${fmt(c.price)} ${pctStr(c.pct)}`.trim());
  }
  if (m.forex?.updated) L.push('', `_Güncelleme: ${m.forex.updated}_`);
  return L.join('\n');
}

async function composeNews() {
  const news = await src.getNews(6);
  const L = ['📰 *Yapay Zeka & Teknoloji Haberleri*', ''];
  if (!news.length) { L.push('(haber alınamadı, kaynaklar geçici olarak yanıt vermiyor)'); return L.join('\n'); }
  news.forEach((h, i) => L.push(`${i + 1}. ${h}`));
  L.push('', '_Kaynak: TechCrunch AI, The Verge, Ars Technica, VentureBeat, Wired_');
  return L.join('\n');
}

async function composePrayer() {
  const p = await src.getPrayer();
  const t = p.timings;
  const sig = content.getHijriSignificance(p.hijri.monthNumber, p.hijri.day, p.hijri.holidays);
  const monthTr = content.hijriMonthTr(p.hijri.monthNumber) || p.hijri.monthName;
  const L = [
    '🕌 *Namaz Vakitleri — Balıkesir*', '',
    `• İmsak: ${t.imsak}`,
    `• Güneş: ${t.gunes}`,
    `• Öğle: ${t.ogle}`,
    `• İkindi: ${t.ikindi}`,
    `• Akşam: ${t.aksam}`,
    `• Yatsı: ${t.yatsi}`,
    '',
    `📅 *Hicri Tarih:* ${p.hijri.day} ${monthTr} ${p.hijri.year}`,
  ];
  if (sig) L.push('', `✨ *Günün Önemi:* ${sig}`);
  return L.join('\n');
}

async function composeAyah() {
  try {
    const a = await quran.getDailyAyah();
    const L = ['📖 *Günün Ayeti*', '', a.arabic, '', `“${a.diyanet}”`, '', `— *${a.ref}* (Diyanet İşleri meali)`];
    if (a.elmalili) L.push('', `📝 *Elmalılı Hamdi Yazır meali:* ${a.elmalili}`);
    L.push('', "_Kaynak: Kur'an-ı Kerim — quran.com (Diyanet & Elmalılı). Ayrıntılı tefsir için Erkam Yay._");
    return L.join('\n');
  } catch (e) {
    const a = content.getAyah();
    return [
      '📖 *Günün Ayeti*', '',
      `“${a.meal}”`, '',
      `— *${a.ref}* (Diyanet İşleri meali)`, '',
      `📝 *Tefsir notu:* ${a.tefsir}`,
      '_(Ayrıntılı tefsir için Erkam Yay. kaynaklarına bakınız.)_',
    ].join('\n');
  }
}

function composeHadith() {
  const h = content.getHadith();
  return [
    '☪️ *Günün Hadisi*', '',
    `“${h.text}”`, '',
    `— Hz. Muhammed (sav)`,
    `_Kaynak: ${h.source}_`,
  ].join('\n');
}

function composeMotivation() {
  const m = content.getMotivation();
  return [
    '💪 *Günün Motivasyonu*', '',
    `“${m.text}”`, '',
    `— ${m.by}`,
  ].join('\n');
}

async function composeFull() {
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Günaydın patron! ☀️' : h < 18 ? 'İyi günler patron! 🌤️' : 'İyi akşamlar patron! 🌙';
  })();
  const parts = await Promise.allSettled([
    composePrayer(), Promise.resolve(composeAyah()), Promise.resolve(composeHadith()),
    composeMarkets(), composeNews(),
    Promise.resolve(mentor.composeMentor()), Promise.resolve(advisor.composeAdvisor()),
  ]);
  const blocks = parts.map((p) => (p.status === 'fulfilled' ? p.value : '_(bu bölüm alınamadı)_'));
  return [`${greeting}\n\n🗓️ *Günlük Brifing*`, ...blocks].join('\n\n──────────\n\n');
}

// --- Zamanlayıcı -------------------------------------------------------------

function tick(send) {
  if (!config.enabled) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = now.toISOString().slice(0, 10);
  if (hhmm === config.time && lastSentDay() !== today) {
    markSent(today);
    composeFull().then((text) => send(text)).catch((e) => console.warn('[daily] send:', e.message));
  }
}

function start(send) {
  loadConfig();
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick(send), 30_000);
  console.log('[daily] scheduler started, enabled=', config.enabled, 'time=', config.time);
}

// --- HTTP --------------------------------------------------------------------

function shouldHandle(url) { return url.startsWith('/api/daily'); }

function readBody(req) {
  return new Promise((resolve) => {
    const cs = []; req.on('data', (c) => cs.push(c));
    req.on('end', () => { try { resolve(cs.length ? JSON.parse(Buffer.concat(cs).toString()) : {}); } catch { resolve({}); } });
  });
}

async function handleHttp(req, res, send) {
  res.setHeader('Content-Type', 'application/json');
  const url = req.url.split('?')[0];
  try {
    if (url === '/api/daily/state' && req.method === 'GET') {
      res.writeHead(200); res.end(JSON.stringify({ ...config, last_sent: lastSentDay() })); return;
    }
    if (url === '/api/daily/save' && req.method === 'POST') {
      const b = await readBody(req);
      if (typeof b.enabled === 'boolean') config.enabled = b.enabled;
      if (typeof b.time === 'string' && /^\d{2}:\d{2}$/.test(b.time)) config.time = b.time;
      saveConfig();
      res.writeHead(200); res.end(JSON.stringify({ ok: true, ...config })); return;
    }
    if (url === '/api/daily/preview' && req.method === 'GET') {
      const text = await composeFull();
      res.writeHead(200); res.end(JSON.stringify({ ok: true, text })); return;
    }
    if (url === '/api/daily/send' && req.method === 'POST') {
      const text = await composeFull();
      if (typeof send === 'function') await send(text);
      res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = {
  start, shouldHandle, handleHttp,
  composeMarkets, composeNews, composePrayer, composeAyah, composeHadith, composeMotivation, composeFull,
};
