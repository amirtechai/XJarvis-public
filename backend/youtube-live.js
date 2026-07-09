/**
 * YouTube live stream resolver — handle → mevcut canlı videoId
 *
 *   GET /api/youtube/live?handle=tv100 → {ok, videoId, channelId}
 *
 * Mantık:
 *   1. https://www.youtube.com/@HANDLE/live  → 200 ile gelir, içinde "ytInitialData"
 *   2. JSON içinden videoId regex ile çekilir
 *   3. 1 dakika cache (canlı video genelde sabit)
 */
const https = require('https');

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // handle → {ts, data}

function fetchHtml(url) {
  return new Promise((resolve) => {
    const req = https.request(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 8000,
    }, (res) => {
      // 3xx → follow location
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) loc = 'https://www.youtube.com' + loc;
        return fetchHtml(loc).then(resolve);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    req.on('error', (e) => {
      console.warn('[youtube] fetch:', e.code || e.message);
      resolve('');
    });
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.end();
  });
}

async function resolveLive(handle) {
  const key = handle.toLowerCase();
  const c = cache.get(key);
  if (c && Date.now() - c.ts < CACHE_TTL_MS) return c.data;

  // /@handle/live yönlendirmesi otomatik mevcut canlıya gider
  const html = await fetchHtml(`https://www.youtube.com/@${encodeURIComponent(handle)}/live`);
  if (!html) return { ok: false, error: 'fetch failed' };

  const vidMatch = html.match(/"videoId":"([\w-]{11})"/);
  const chMatch  = html.match(/"channelId":"(UC[\w-]+)"/);
  const titleMatch = html.match(/"title":\{"runs":\[\{"text":"([^"]+)"/);

  if (!vidMatch) {
    // Canlı yayın yoksa @handle sayfası gelir, ama videoId mevcut değildir
    return { ok: false, error: 'no live stream', channelId: chMatch?.[1] || null };
  }

  const data = {
    ok: true,
    videoId: vidMatch[1],
    channelId: chMatch?.[1] || null,
    title: titleMatch?.[1] || null,
  };
  cache.set(key, { ts: Date.now(), data });
  return data;
}

/**
 * Yapıştırılan URL'den kind + identifier çıkar.
 * Desteklenen formatlar:
 *   https://youtu.be/VIDEOID
 *   https://www.youtube.com/watch?v=VIDEOID
 *   https://www.youtube.com/embed/VIDEOID
 *   https://www.youtube.com/@HANDLE        → live varsa videoId
 *   https://www.youtube.com/@HANDLE/live   → live varsa videoId
 *   https://www.youtube.com/channel/UCxxxx → channelId
 */
async function resolveUrl(input) {
  const url = String(input || '').trim();
  if (!url) return { ok: false, error: 'url required' };
  try {
    let m;
    m = url.match(/youtu\.be\/([\w-]{11})/);
    if (m) return { ok: true, kind: 'video', videoId: m[1] };
    m = url.match(/[?&]v=([\w-]{11})/);
    if (m) return { ok: true, kind: 'video', videoId: m[1] };
    m = url.match(/youtube\.com\/embed\/([\w-]{11})/);
    if (m) return { ok: true, kind: 'video', videoId: m[1] };
    m = url.match(/youtube\.com\/channel\/(UC[\w-]+)/);
    if (m) return { ok: true, kind: 'channel', channelId: m[1] };
    m = url.match(/youtube\.com\/@([\w.-]+)/);
    if (m) {
      const handle = m[1];
      const live = await resolveLive(handle);
      if (live.ok) return { ok: true, kind: 'handle', handle, videoId: live.videoId, channelId: live.channelId, title: live.title };
      return { ok: true, kind: 'handle', handle, videoId: null, channelId: live.channelId || null, live: false };
    }
  } catch (e) { return { ok: false, error: e.message }; }
  return { ok: false, error: 'unsupported url' };
}

/**
 * Birden fazla handle için canlı yayın durumunu döndürür.
 *   POST /api/youtube/live-status  body: {handles: ["tv100", "ntv", ...]}
 *   → {results: {tv100: {ok, videoId, channelId, title}}}
 */
async function batchLiveStatus(handles) {
  const list = (Array.isArray(handles) ? handles : []).slice(0, 20);
  const entries = await Promise.all(list.map(async (h) => {
    const r = await resolveLive(String(h || '').replace(/^@/, '').slice(0, 60));
    return [h, r];
  }));
  return { ok: true, results: Object.fromEntries(entries) };
}

function shouldHandle(url) { return url.startsWith('/api/youtube/'); }

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b || ''));
  });
}

async function handleHttp(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/youtube/live') {
      res.setHeader('Content-Type', 'application/json');
      const handle = (u.searchParams.get('handle') || '').replace(/^@/, '').slice(0, 60);
      if (!handle) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'handle required' })); return;
      }
      const r = await resolveLive(handle);
      res.writeHead(200); res.end(JSON.stringify(r));
      return;
    }
    // Embed wrapper — Tauri webview "tauri://" origin'i YouTube tarafından
    // referrer olarak reddediliyor (Hata 153). Bu küçük HTML sayfası gerçek
    // http://127.0.0.1:3001 origin'inden serve edildiği için iframe içindeki
    // YouTube embed'i geçerli bir referrer ile yüklenir.
    if (req.method === 'GET' && u.pathname === '/api/youtube/embed') {
      const channel = (u.searchParams.get('channel') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
      const video = (u.searchParams.get('video') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
      const mute = u.searchParams.get('mute') === '0' ? '0' : '1';
      let src;
      if (channel) src = `https://www.youtube.com/embed/live_stream?channel=${channel}&autoplay=1&mute=${mute}&rel=0&playsinline=1`;
      else if (video) src = `https://www.youtube.com/embed/${video}?autoplay=1&mute=${mute}&rel=0&playsinline=1`;
      else { res.writeHead(400); res.end('channel or video required'); return; }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.writeHead(200);
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>
html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}
.wrap{position:fixed;inset:0;background:#000;overflow:hidden}
/* Fill the pane completely: the YouTube iframe covers the whole wrapper so no
   YouTube page background (white) can leak around the player. YouTube itself
   letterboxes the actual video in BLACK inside the iframe when aspect differs,
   which matches the pane bg seamlessly. */
iframe{position:absolute;inset:0;border:0;background:#000;width:100%;height:100%;display:block}
</style>
</head><body>
<div class="wrap">
<iframe src="${src}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
</div>
</body></html>`);
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/youtube/resolve-url') {
      res.setHeader('Content-Type', 'application/json');
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await resolveUrl(body.url || '');
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/youtube/live-status') {
      res.setHeader('Content-Type', 'application/json');
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await batchLiveStatus(body.handles || []);
      res.writeHead(200); res.end(JSON.stringify(r));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle, resolveLive, resolveUrl, batchLiveStatus };
