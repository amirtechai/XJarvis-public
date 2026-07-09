/**
 * Günün film tavsiyeleri — YENİ çıkan filmler (TMDB), Türkçe özet + puan +
 * Türkiye'de YASAL izleme platformu (JustWatch/TMDB watch providers).
 * Env: TMDB_API_KEY (ücretsiz). Türkçe dublaj/altyazı platformda mevcutsa gösterilir.
 */
const https = require('https');
const KEY = () => process.env.TMDB_API_KEY || '';

function tmdb(path, params = {}) {
  const qs = new URLSearchParams({ api_key: KEY(), language: 'tr-TR', ...params }).toString();
  return new Promise((resolve, reject) => {
    https.get(`https://api.themoviedb.org/3${path}?${qs}`, { timeout: 12000 }, (res) => {
      const cs = []; res.on('data', (c) => cs.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(cs).toString())); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

async function providersTR(id) {
  try {
    const j = await tmdb(`/movie/${id}/watch/providers`);
    const tr = j?.results?.TR;
    if (!tr) return null;
    const names = [...new Set([...(tr.flatrate || []), ...(tr.rent || []), ...(tr.buy || [])].map((p) => p.provider_name))];
    return { names: names.slice(0, 4), link: tr.link };
  } catch { return null; }
}

async function composeFilms() {
  if (!KEY()) return '🎬 Film tavsiyesi için TMDB_API_KEY gerekli (sahibi ekleyecek).';
  try {
    const today = new Date();
    const gte = new Date(today.getTime() - 75 * 86400000).toISOString().slice(0, 10);
    const lte = today.toISOString().slice(0, 10);
    const j = await tmdb('/discover/movie', {
      sort_by: 'popularity.desc', 'primary_release_date.gte': gte, 'primary_release_date.lte': lte,
      'vote_count.gte': '30', watch_region: 'TR', with_watch_monetization_types: 'flatrate|rent|buy', page: '1',
    });
    const films = (j.results || []).slice(0, 6);
    const L = ['🎬 *Günün Film Tavsiyeleri*', '_Yeni çıkan, Türkiye\'de yasal izlenebilen filmler_', ''];
    let n = 0;
    for (const f of films) {
      const prov = await providersTR(f.id);
      if (!prov || !prov.names.length) continue; // yasal platformda yoksa atla
      n++;
      const rating = f.vote_average ? `⭐ ${f.vote_average.toFixed(1)}` : '';
      let ov = (f.overview || '').replace(/\s+/g, ' ').trim();
      if (ov.length > 160) ov = ov.slice(0, 160) + '…';
      L.push(`🎞️ *${f.title}* (${(f.release_date || '').slice(0, 4)}) ${rating}`);
      if (ov) L.push(`  ${ov}`);
      L.push(`  📺 *${prov.names.join(', ')}* · [yasal izle →](${prov.link})`);
      L.push('');
      if (n >= 4) break;
    }
    if (!n) return '🎬 Bugün için Türkiye\'de yasal platformda yeni film bulunamadı.';
    L.push('_Kaynak: TMDB · JustWatch (Türkiye)_');
    return L.join('\n');
  } catch (e) { return `🎬 Film tavsiyesi alınamadı (${e.message}).`; }
}

module.exports = { composeFilms };
