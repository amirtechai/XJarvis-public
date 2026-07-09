/**
 * Günlük kitap tavsiyesi — YENİ çıkan eserler (Google Books, orderBy=newest).
 * Türkiye satış linki: kitapyurdu arama. Env: GOOGLE_BOOKS_KEY.
 * Books API etkin değilse graceful mesaj döner.
 */
const https = require('https');

const TOPICS = [
  ['intitle:yapay intitle:zeka', 'Yapay Zekâ'],
  ['intitle:teknoloji', 'Teknoloji'],
  ['intitle:finans', 'Finans'],
  ['intitle:girişimcilik', 'Girişimcilik'],
  ['intitle:liderlik', 'Liderlik & İş'],
  ['intitle:robot', 'Robotik'],
  ['intitle:drone', 'Drone'],
  ['intitle:savunma intitle:sanayi', 'Savunma Sanayi'],
  ['intitle:yarı intitle:iletken', 'Çip/Yarı İletken'],
  ['intitle:elektrikli intitle:araç', 'Elektrikli Araç'],
  ['intitle:batarya', 'Batarya'],
  ['intitle:biyografi', 'Biyografi'],
  ['intitle:siber intitle:güvenlik', 'Siber Güvenlik'],
  ['intitle:uzay', 'Uzay Teknolojisi'],
  ['intitle:kuantum', 'Kuantum'],
  ['intitle:inovasyon', 'İnovasyon'],
  ['intitle:blok intitle:zincir', 'Blokzincir'],
]

function dayOfYear(d = new Date()) { const s = new Date(d.getFullYear(), 0, 0); return Math.floor((d - s) / 86400000); }

function fetchJson(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'XJarvis/1.0' }, timeout }, (res) => {
      const cs = []; res.on('data', (c) => cs.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(cs).toString())); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

const kitapyurdu = (title) => 'https://www.kitapyurdu.com/index.php?route=product/search&filter_name=' + encodeURIComponent(title);
const recentYear = () => new Date().getFullYear() - 2;

async function booksForTopic(query) {
  const key = process.env.GOOGLE_BOOKS_KEY ? `&key=${process.env.GOOGLE_BOOKS_KEY}` : '';
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&orderBy=newest&maxResults=20&country=TR${key}`;
  const j = await fetchJson(url);
  if (j.error) throw new Error(j.error.message || 'books api');
  const items = (j.items || []).map((i) => i.volumeInfo).filter(Boolean);
  // yeni çıkanlar: son 2 yıl, başlık + açıklama olanlar
  const JUNK = /symposium|proceeding|bildiri|sempozyum|kongre|congress|thesis|journal|dergi|abstract|conference|yıllığı|katalog/i;
  const ok = (v) => v && v.title && !JUNK.test(v.title);
  const cy = new Date().getFullYear();
  const recent = items.filter((v) => ok(v) && parseInt((v.publishedDate || '0').slice(0, 4), 10) >= cy - 5);
  const sorted = recent.sort((a, b) => (b.publishedDate || '').localeCompare(a.publishedDate || ''));
  // açıklaması olanı öne al
  sorted.sort((a, b) => ((b.description || '').length > 40 ? 1 : 0) - ((a.description || '').length > 40 ? 1 : 0));
  return (sorted.length ? sorted : items.filter(ok)).slice(0, 3);
}

async function composeBooks() {
  // günlük 4 rotasyon konusu
  const start = dayOfYear() % TOPICS.length;
  const todays = [0, 1, 2, 3].map((k) => TOPICS[(start + k * 4) % TOPICS.length]);
  const L = ['📚 *Günün Kitap Tavsiyeleri*', '_Yeni çıkan eserler · konu başına bir öneri_', ''];
  let any = false, apiErr = '';
  for (const [q, label] of todays) {
    try {
      const books = await booksForTopic(q);
      const b = books[0];
      if (!b) continue;
      any = true;
      const auth = (b.authors || []).join(', ');
      let desc = (b.description || '').replace(/\s+/g, ' ').trim();
      if (desc.length > 180) desc = desc.slice(0, 180) + '…';
      L.push(`📖 *${label} —* *${b.title}*${auth ? ` · ${auth}` : ''}${b.publishedDate ? ` (${b.publishedDate.slice(0, 4)})` : ''}`);
      if (desc) L.push(`  ${desc}`);
      L.push(`  [🛒 Türkiye'de satın al →](${kitapyurdu(b.title)})`);
      L.push('');
    } catch (e) { apiErr = e.message; }
  }
  if (!any) return `📚 Kitap tavsiyesi alınamadı. ${/disabled|has not been used/i.test(apiErr) ? '(Google Books API etkin değil — sahibinin etkinleştirmesi gerek.)' : '(' + apiErr + ')'}`;
  L.push('_Linkler kitapyurdu.com aramasına gider (Türkiye)._');
  return L.join('\n');
}

module.exports = { composeBooks };
