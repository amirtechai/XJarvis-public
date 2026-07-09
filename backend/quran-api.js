/**
 * Kur'an API — quran.com / Quran Foundation (mcp.quran.ai kaynağı) üzerinden
 * günün ayetini canlı çeker: Arapça orijinal + Diyanet meali + Elmalılı meali.
 * Tüm Kur'an kapsanır; metin doğrulanmıştır (LLM'e uydurtulmaz).
 *
 * Türkçe çeviri ID'leri: 77 = Diyanet İşleri, 52 = Elmalılı Hamdi Yazır.
 */
const https = require('https');

// Anlamca öne çıkan, brifinge uygun ayetler (sure:ayet + Türkçe ad).
const VERSES = [
  { key: '2:286', name: 'Bakara, 286' }, { key: '94:5', name: 'İnşirah, 5-6' },
  { key: '65:3', name: 'Talak, 2-3' }, { key: '13:28', name: "Ra'd, 28" },
  { key: '39:53', name: 'Zümer, 53' }, { key: '2:153', name: 'Bakara, 153' },
  { key: '3:159', name: 'Âl-i İmrân, 159' }, { key: '65:7', name: 'Talak, 7' },
  { key: '16:97', name: 'Nahl, 97' }, { key: '25:74', name: 'Furkan, 74' },
  { key: '2:216', name: 'Bakara, 216' }, { key: '12:87', name: 'Yûsuf, 87' },
  { key: '40:60', name: "Mü'min, 60" }, { key: '57:4', name: 'Hadîd, 4' },
  { key: '2:152', name: 'Bakara, 152' }, { key: '14:7', name: 'İbrahim, 7' },
  { key: '18:24', name: 'Kehf, 23-24' }, { key: '31:18', name: 'Lokman, 18' },
  { key: '49:13', name: 'Hucurât, 13' }, { key: '3:139', name: 'Âl-i İmrân, 139' },
  { key: '9:40', name: 'Tevbe, 40' }, { key: '2:45', name: 'Bakara, 45' },
  { key: '93:4', name: 'Duhâ, 4-5' }, { key: '29:69', name: 'Ankebût, 69' },
  { key: '2:255', name: 'Bakara, 255 (Âyetü\'l-Kürsî)' }, { key: '55:13', name: 'Rahmân, 13' },
  { key: '3:185', name: 'Âl-i İmrân, 185' }, { key: '6:162', name: "En'âm, 162" },
  { key: '17:23', name: 'İsrâ, 23' }, { key: '17:24', name: 'İsrâ, 24' },
  { key: '24:35', name: 'Nûr, 35' }, { key: '49:10', name: 'Hucurât, 10' },
  { key: '64:11', name: 'Tegâbün, 11' }, { key: '94:6', name: 'İnşirah, 6' },
  { key: '103:1', name: 'Asr, 1-3' }, { key: '112:1', name: 'İhlâs, 1' },
  { key: '2:45', name: 'Bakara, 45' }, { key: '8:46', name: 'Enfâl, 46' },
  { key: '42:43', name: 'Şûrâ, 43' }, { key: '53:39', name: 'Necm, 39' },
];

function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86_400_000);
}

function fetchJson(url, timeout = 9000) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'XJarvis/1.0', Accept: 'application/json' }, timeout }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(cs).toString('utf-8'))); }
        catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

const strip = (s) => (s || '').replace(/<sup[^>]*>.*?<\/sup>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function getDailyAyah(date = new Date()) {
  const v = VERSES[dayOfYear(date) % VERSES.length];
  const url = `https://api.quran.com/api/v4/verses/by_key/${v.key}?language=tr&translations=77,52&fields=text_uthmani`;
  const j = await fetchJson(url);
  const verse = j?.verse;
  if (!verse) throw new Error('quran.com empty');
  const tr = verse.translations || [];
  const byId = (id) => strip((tr.find((t) => t.resource_id === id) || {}).text);
  return {
    ref: v.name,
    arabic: (verse.text_uthmani || '').trim(),
    diyanet: byId(77) || strip((tr[0] || {}).text),
    elmalili: byId(52) || '',
  };
}

module.exports = { getDailyAyah };
