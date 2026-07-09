/**
 * Spotify OAuth (Authorization Code flow) + Web API entegrasyonu.
 *
 *   GET /api/spotify/oauth/start     → Spotify consent URL'ine yönlendir
 *   GET /api/spotify/oauth/callback  → token al, .env'e yaz
 *   GET /api/spotify/oauth/status    → connected, expires_at, scopes
 *
 *   GET /api/spotify/now-playing     → Web API now-playing (cihaz bağımsız)
 *   GET /api/spotify/search?q=&type= → track/album/artist/playlist arama
 *   POST /api/spotify/play {uri?, query?}  → URI veya query ile çal (Premium)
 *
 * Redirect URI: http://127.0.0.1:3001/api/spotify/oauth/callback
 *   (Spotify dashboard → uygulama → "Redirect URIs" listesine bu URL'i EKLEMELİSİN.)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');

const ENV_PATH = path.join(__dirname, '.env');
const REDIRECT_URI = 'http://127.0.0.1:3001/api/spotify/oauth/callback';

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
  'user-top-read',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

function readEnv() {
  try {
    const lines = fs.readFileSync(ENV_PATH, 'utf-8').split('\n');
    const env = {};
    for (const ln of lines) {
      const m = ln.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
    return env;
  } catch { return {}; }
}

function writeEnvPatch(patch) {
  const lines = (fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '').split('\n');
  for (const [k, v] of Object.entries(patch)) {
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(`${k}=`)) { lines[i] = `${k}=${v}`; found = true; break; }
    }
    if (!found) lines.push(`${k}=${v}`);
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n'));
  for (const [k, v] of Object.entries(patch)) process.env[k] = v;
}

function httpsPostForm(host, p, data, basicAuth) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(data);
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    };
    if (basicAuth) headers['Authorization'] = `Basic ${basicAuth}`;
    const req = https.request({ host, path: p, method: 'POST', headers, timeout: 10_000 }, (res) => {
      const cs = []; res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const text = Buffer.concat(cs).toString();
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, json: { raw: text } }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}

async function refreshSpotifyToken() {
  const env = readEnv();
  if (!env.SPOTIFY_REFRESH_TOKEN) return { ok: false, error: 'no refresh_token' };
  const basic = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const r = await httpsPostForm('accounts.spotify.com', '/api/token', {
    grant_type: 'refresh_token',
    refresh_token: env.SPOTIFY_REFRESH_TOKEN,
  }, basic);
  if (r.status !== 200 || !r.json.access_token) return { ok: false, body: r.json };
  const expiresAt = Date.now() + ((r.json.expires_in || 3600) - 30) * 1000;
  writeEnvPatch({
    SPOTIFY_ACCESS_TOKEN: r.json.access_token,
    SPOTIFY_TOKEN_EXPIRES_AT: String(expiresAt),
  });
  return { ok: true };
}

async function ensureToken() {
  const env = readEnv();
  const exp = parseInt(env.SPOTIFY_TOKEN_EXPIRES_AT || '0', 10);
  if (env.SPOTIFY_ACCESS_TOKEN && Date.now() < exp - 30_000) return env.SPOTIFY_ACCESS_TOKEN;
  const r = await refreshSpotifyToken();
  if (!r.ok) return null;
  return readEnv().SPOTIFY_ACCESS_TOKEN;
}

function startHandler(_req, res) {
  const env = readEnv();
  if (!env.SPOTIFY_CLIENT_ID) {
    res.writeHead(503, { 'Content-Type': 'text/html' });
    res.end('<h2>SPOTIFY_CLIENT_ID eksik</h2>');
    return;
  }
  const params = querystring.stringify({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    show_dialog: 'true',
  });
  res.writeHead(302, { Location: `https://accounts.spotify.com/authorize?${params}` });
  res.end();
}

async function callbackHandler(req, res) {
  const u = new URL(req.url, 'http://localhost:3001');
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');
  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Spotify OAuth hata: ${error}</h2>`);
    return;
  }
  if (!code) { res.writeHead(400); res.end('no code'); return; }
  const env = readEnv();
  const basic = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const r = await httpsPostForm('accounts.spotify.com', '/api/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  }, basic);
  if (r.status !== 200 || !r.json.access_token) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<pre>${JSON.stringify(r.json, null, 2)}</pre>`);
    return;
  }
  const expiresAt = Date.now() + ((r.json.expires_in || 3600) - 30) * 1000;
  writeEnvPatch({
    SPOTIFY_ACCESS_TOKEN: r.json.access_token,
    SPOTIFY_REFRESH_TOKEN: r.json.refresh_token || readEnv().SPOTIFY_REFRESH_TOKEN || '',
    SPOTIFY_TOKEN_EXPIRES_AT: String(expiresAt),
  });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html><html><head><title>Spotify bağlandı</title>
    <style>body{background:#000a14;color:#1ed760;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{padding:36px 60px;border:1px solid rgba(30,215,96,0.5);border-radius:8px;background:rgba(0,40,20,0.25);box-shadow:0 0 24px rgba(30,215,96,0.3);text-align:center}h1{font-size:1.4rem;letter-spacing:0.4em;margin:0 0 16px}</style></head>
    <body><div class="card"><h1>♫ SPOTIFY BAĞLANDI</h1><p style="opacity:0.7">Bu pencereyi kapatabilirsin patron.</p></div></body></html>
  `);
}

function statusHandler(_req, res) {
  const env = readEnv();
  const exp = parseInt(env.SPOTIFY_TOKEN_EXPIRES_AT || '0', 10);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    connected: !!env.SPOTIFY_ACCESS_TOKEN && !!env.SPOTIFY_REFRESH_TOKEN,
    expires_at: exp,
    needs_refresh: !!env.SPOTIFY_ACCESS_TOKEN && Date.now() > exp,
    scopes: SCOPES.split(' '),
  }));
}

// ─────────────────── Web API endpoints

function spotifyApi(method, path, body, token) {
  return new Promise((resolve) => {
    const isJson = body && typeof body === 'object';
    const payload = isJson ? JSON.stringify(body) : '';
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const req = https.request({ host: 'api.spotify.com', path, method, headers, timeout: 10_000 }, (res) => {
      const cs = []; res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const text = Buffer.concat(cs).toString();
        try { resolve({ status: res.statusCode, json: text ? JSON.parse(text) : {} }); }
        catch { resolve({ status: res.statusCode, json: { raw: text } }); }
      });
    });
    req.on('error', () => resolve({ status: 0, json: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: {} }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function nowPlayingHandler(_req, res) {
  const tok = await ensureToken();
  if (!tok) { res.writeHead(401); res.end(JSON.stringify({ ok: false, error: 'no token' })); return; }
  const r = await spotifyApi('GET', '/v1/me/player/currently-playing', null, tok);
  if (r.status === 204) { res.writeHead(200); res.end(JSON.stringify({ ok: true, playing: false })); return; }
  if (r.status !== 200) { res.writeHead(r.status); res.end(JSON.stringify({ ok: false, body: r.json })); return; }
  const item = r.json.item || {};
  res.writeHead(200);
  res.end(JSON.stringify({
    ok: true, playing: r.json.is_playing,
    title: item.name, artist: (item.artists || []).map((a) => a.name).join(', '),
    album: item.album?.name, art: item.album?.images?.[1]?.url || item.album?.images?.[0]?.url,
    progress_ms: r.json.progress_ms, duration_ms: item.duration_ms,
    uri: item.uri,
  }));
}

async function searchHandler(req, res) {
  const tok = await ensureToken();
  if (!tok) { res.writeHead(401); res.end(JSON.stringify({ ok: false, error: 'no token' })); return; }
  const u = new URL(req.url, 'http://x');
  const q = u.searchParams.get('q') || '';
  const type = u.searchParams.get('type') || 'track';
  const limit = parseInt(u.searchParams.get('limit') || '5', 10);
  if (!q) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'q required' })); return; }
  const r = await spotifyApi('GET', `/v1/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`, null, tok);
  if (r.status !== 200) { res.writeHead(r.status); res.end(JSON.stringify({ ok: false, body: r.json })); return; }
  const tracks = (r.json.tracks?.items || []).map((t) => ({
    uri: t.uri, name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album?.name, duration_ms: t.duration_ms,
  }));
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, tracks }));
}

function readBody(req) { return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); }); }

async function playHandler(req, res) {
  const tok = await ensureToken();
  if (!tok) { res.writeHead(401); res.end(JSON.stringify({ ok: false, error: 'no token' })); return; }
  const body = JSON.parse((await readBody(req)) || '{}');
  let uri = body.uri;
  if (!uri && body.query) {
    // Önce ara, ilk sonucu çal
    const sr = await spotifyApi('GET', `/v1/search?q=${encodeURIComponent(body.query)}&type=track&limit=1`, null, tok);
    uri = sr.json?.tracks?.items?.[0]?.uri;
  }
  if (!uri) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'uri or query required' })); return; }
  const r = await spotifyApi('PUT', '/v1/me/player/play', { uris: [uri] }, tok);
  // 404 = no active device — uygulamayı aç ve tekrar dene
  if (r.status === 404) {
    res.writeHead(409);
    res.end(JSON.stringify({ ok: false, error: 'Aktif cihaz yok. Spotify uygulamasını aç ve tekrar dene.' }));
    return;
  }
  res.writeHead(r.status >= 300 ? r.status : 200);
  res.end(JSON.stringify({ ok: r.status < 300, uri, body: r.json }));
}

// ─────────────────── ROUTING

function shouldHandle(url) { return url.startsWith('/api/spotify/'); }

async function handleHttp(req, res) {
  const u = req.url;
  if (u.startsWith('/api/spotify/oauth/start'))    return startHandler(req, res);
  if (u.startsWith('/api/spotify/oauth/callback')) return callbackHandler(req, res);
  if (u.startsWith('/api/spotify/oauth/status'))   return statusHandler(req, res);
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET'  && u.startsWith('/api/spotify/now-playing')) return nowPlayingHandler(req, res);
  if (req.method === 'GET'  && u.startsWith('/api/spotify/search'))      return searchHandler(req, res);
  if (req.method === 'POST' && u.startsWith('/api/spotify/play'))        return playHandler(req, res);
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

function startRefreshLoop() {
  const tick = async () => {
    const env = readEnv();
    if (!env.SPOTIFY_REFRESH_TOKEN) return;
    const exp = parseInt(env.SPOTIFY_TOKEN_EXPIRES_AT || '0', 10);
    if (Date.now() > exp - 5 * 60_000) {
      const r = await refreshSpotifyToken().catch(() => ({ ok: false }));
      if (r.ok) console.log('[spotify] token refreshed');
    }
  };
  setInterval(tick, 5 * 60_000);
  tick();
}

module.exports = { shouldHandle, handleHttp, refreshSpotifyToken, startRefreshLoop };
