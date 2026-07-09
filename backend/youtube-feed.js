/**
 * Günlük YouTube tavsiyesi — itibarlı kanallardan SON videolar (key'siz RSS).
 * "Gerçek, hype değil": küratörlü kaliteli kanallar. Son ~48 saatteki videolar.
 */
const https = require('https');

// Küratörlü kanallar (name | channel_id | alan)
const CHANNELS = [
  ['Fireship', 'UCsBjURrPoezykLs9EqgamOA', 'kodlama/AI/araç'],
  ['Two Minute Papers', 'UCbfYPyITQ-7l4upoX8nvctg', 'yapay zeka araştırma'],
  ['Lex Fridman', 'UCSHZKyawb77ixDdsGog4iWA', 'AI/iş/teknoloji'],
  ['MKBHD', 'UCBJycsmduvYEL83R_U4JriQ', 'teknoloji/EV'],
  ['Y Combinator', 'UCcefcZRL2oaA_uBNeo5UOWg', 'startup/iş dünyası'],
  ['ColdFusion', 'UC4QZ_LsYcvcq7qOsOhpAX4A', 'teknoloji/iş hikâyeleri'],
  ['Matthew Berman', 'UCawZsQWqfGSbCI5yjkdVkTA', 'AI araçları/haber'],
  ['Bloomberg Originals', 'UCUMZ7gohGI9HcU9VNsr2FJQ', 'finans/iş'],
];

function fetchText(url, timeout = 9000) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 XJarvis' }, timeout }, (res) => {
      const cs = []; res.on('data', (c) => cs.push(c));
      res.on('end', () => resolve(Buffer.concat(cs).toString('utf-8')));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

function decode(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseFeed(xml, channelName, domain) {
  const out = [];
  const entries = xml.split('<entry>').slice(1);
  for (const e of entries) {
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1];
    const pub = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    if (id && title && pub) out.push({ id, title: decode(title), pub: Date.parse(pub), channel: channelName, domain });
  }
  return out;
}

async function getDailyVideos(maxItems = 7, windowHours = 48) {
  const results = await Promise.allSettled(
    CHANNELS.map(([name, id, dom]) => fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`).then((x) => parseFeed(x, name, dom))),
  );
  let vids = [];
  for (const r of results) if (r.status === 'fulfilled') vids = vids.concat(r.value);
  const now = Date.now();
  let recent = vids.filter((v) => now - v.pub <= windowHours * 3600_000);
  if (recent.length < 4) recent = vids.filter((v) => now - v.pub <= 96 * 3600_000); // gevşet (4 gün)
  recent.sort((a, b) => b.pub - a.pub);
  // kanal başına en fazla 2 (çeşitlilik)
  const perCh = {}; const picked = [];
  for (const v of recent) {
    perCh[v.channel] = (perCh[v.channel] || 0);
    if (perCh[v.channel] >= 2) continue;
    perCh[v.channel]++; picked.push(v);
    if (picked.length >= maxItems) break;
  }
  return picked;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit' });
}

async function composeVideos() {
  let vids = [];
  try { vids = await getDailyVideos(); } catch (e) { return '🎬 Video tavsiyesi alınamadı (kaynak geçici yanıt vermiyor).'; }
  if (!vids.length) return '🎬 Bugün için yeni video bulunamadı.';
  const L = ['🎬 *Günün Video Tavsiyeleri*', '_İtibarlı kanallardan son videolar · gerçek içerik, hype değil_', ''];
  vids.forEach((v) => {
    L.push(`• [${v.title}](https://youtu.be/${v.id})`);
    L.push(`  _${v.channel} · ${v.domain} · ${fmtDate(v.pub)}_`);
  });
  return L.join('\n');
}

module.exports = { composeVideos, getDailyVideos };
