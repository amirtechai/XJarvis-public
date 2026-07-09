/**
 * Google OAuth 2.0 — Gmail + Calendar + People + Drive + Tasks için tek-seferlik
 * yetki akışı.
 *
 *   GET /api/google/oauth/start     → tarayıcıyı consent URL'ine yönlendirir
 *   GET /api/google/oauth/callback  → ?code=... ile döner, token'ı .env'e yazar
 *   GET /api/google/oauth/status    → {connected, scopes, expires_at, email}
 *   POST /api/google/oauth/refresh  → refresh token ile yeni access token
 *   POST /api/google/oauth/logout   → tokenları sil
 *
 * Tokenlar:
 *   GOOGLE_ACCESS_TOKEN
 *   GOOGLE_REFRESH_TOKEN
 *   GOOGLE_TOKEN_EXPIRES_AT  (epoch ms)
 *   GOOGLE_USER_EMAIL_VERIFIED
 *
 * Redirect URI: http://localhost:3001/api/google/oauth/callback
 *   (Google Cloud Console "Desktop app" client'ında "http://localhost" allowed
 *   olduğu için herhangi bir localhost portu kabul edilir.)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');

const ENV_PATH = path.join(__dirname, '.env');

const REDIRECT_URI = 'http://localhost:3001/api/google/oauth/callback';
const SCOPES = [
  'openid',
  'email',
  'profile',
  // Gmail — read + send + draft + modify
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  // Calendar — read + write
  'https://www.googleapis.com/auth/calendar',
  // People (contacts read-only)
  'https://www.googleapis.com/auth/contacts.readonly',
  // Drive (read + write own files)
  'https://www.googleapis.com/auth/drive.file',
  // Tasks
  'https://www.googleapis.com/auth/tasks',
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
  // process.env'i de güncelle (mevcut backend süreç hemen kullanabilsin)
  for (const [k, v] of Object.entries(patch)) process.env[k] = v;
}

function httpsPost(host, p, data) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(data);
    const req = https.request({
      host, path: p, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10_000,
    }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
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

function httpsGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers, timeout: 8000 }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const text = Buffer.concat(cs).toString();
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, json: { raw: text } }); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function exchangeCode(code) {
  const env = readEnv();
  const r = await httpsPost('oauth2.googleapis.com', '/token', {
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  return r;
}

async function refreshToken() {
  const env = readEnv();
  if (!env.GOOGLE_REFRESH_TOKEN) return { ok: false, error: 'no refresh_token' };
  const r = await httpsPost('oauth2.googleapis.com', '/token', {
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  if (r.status !== 200 || !r.json.access_token) return { ok: false, status: r.status, body: r.json };
  const expiresAt = Date.now() + ((r.json.expires_in || 3600) - 30) * 1000;
  writeEnvPatch({
    GOOGLE_ACCESS_TOKEN: r.json.access_token,
    GOOGLE_TOKEN_EXPIRES_AT: String(expiresAt),
  });
  return { ok: true, expires_at: expiresAt };
}

function startHandler(_req, res) {
  const env = readEnv();
  if (!env.GOOGLE_CLIENT_ID) {
    res.writeHead(503, { 'Content-Type': 'text/html' });
    res.end('<h2>GOOGLE_CLIENT_ID eksik (.env)</h2>');
    return;
  }
  const params = querystring.stringify({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',         // refresh_token alalım
    prompt: 'consent',              // her seferinde refresh_token gelsin
    include_granted_scopes: 'true',
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  res.writeHead(302, { Location: url });
  res.end();
}

async function callbackHandler(req, res) {
  const u = new URL(req.url, 'http://localhost:3001');
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');
  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>OAuth hatası: ${error}</h2><p>Bu pencereyi kapatabilirsin.</p>`);
    return;
  }
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>code parametresi yok</h2>');
    return;
  }
  try {
    const r = await exchangeCode(code);
    if (r.status !== 200 || !r.json.access_token) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<pre>token exchange failed: ${JSON.stringify(r.json, null, 2)}</pre>`);
      return;
    }
    const tok = r.json;
    const expiresAt = Date.now() + ((tok.expires_in || 3600) - 30) * 1000;
    // userinfo'yu çek
    let email = '';
    try {
      const ui = await httpsGetJson(`https://www.googleapis.com/oauth2/v2/userinfo`, { Authorization: `Bearer ${tok.access_token}` });
      email = ui.json?.email || '';
    } catch { /* swallow */ }

    writeEnvPatch({
      GOOGLE_ACCESS_TOKEN: tok.access_token,
      GOOGLE_REFRESH_TOKEN: tok.refresh_token || readEnv().GOOGLE_REFRESH_TOKEN || '',
      GOOGLE_TOKEN_EXPIRES_AT: String(expiresAt),
      GOOGLE_USER_EMAIL_VERIFIED: email,
    });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html><head><title>XJarvis · Google bağlandı</title>
      <style>
        body { background:#000a14; color:#00e5ff; font-family:monospace;
               display:flex; align-items:center; justify-content:center;
               height:100vh; margin:0; }
        .card { text-align:center; padding:36px 60px;
                border:1px solid rgba(0,229,255,0.4); border-radius:8px;
                background:rgba(0,40,80,0.25);
                box-shadow:0 0 24px rgba(0,229,255,0.25); }
        h1 { font-size:1.4rem; letter-spacing:0.4em; margin:0 0 16px; }
        p  { opacity:0.7; }
      </style></head><body>
      <div class="card">
        <h1>✓ GOOGLE BAĞLANDI</h1>
        <p>${email}</p>
        <p style="opacity:0.5; font-size:0.8rem">Bu pencereyi kapatabilirsin patron.</p>
      </div></body></html>
    `);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<pre>${e.message}</pre>`);
  }
}

async function statusHandler(_req, res) {
  const env = readEnv();
  const expiresAt = parseInt(env.GOOGLE_TOKEN_EXPIRES_AT || '0', 10);
  const connected = !!env.GOOGLE_ACCESS_TOKEN && !!env.GOOGLE_REFRESH_TOKEN;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    connected,
    email: env.GOOGLE_USER_EMAIL_VERIFIED || env.GOOGLE_USER_EMAIL || '',
    expires_at: expiresAt,
    needs_refresh: connected && Date.now() > expiresAt,
    scopes: SCOPES.split(' '),
  }));
}

async function logoutHandler(_req, res) {
  writeEnvPatch({
    GOOGLE_ACCESS_TOKEN: '',
    GOOGLE_REFRESH_TOKEN: '',
    GOOGLE_TOKEN_EXPIRES_AT: '0',
    GOOGLE_USER_EMAIL_VERIFIED: '',
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

async function refreshHandler(_req, res) {
  const r = await refreshToken();
  res.writeHead(r.ok ? 200 : 500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(r));
}

function shouldHandle(url) { return url.startsWith('/api/google/oauth/'); }

async function handleHttp(req, res) {
  const url = req.url;
  if (url.startsWith('/api/google/oauth/start'))    return startHandler(req, res);
  if (url.startsWith('/api/google/oauth/callback')) return callbackHandler(req, res);
  if (url.startsWith('/api/google/oauth/status'))   return statusHandler(req, res);
  if (req.method === 'POST' && url.startsWith('/api/google/oauth/refresh')) return refreshHandler(req, res);
  if (req.method === 'POST' && url.startsWith('/api/google/oauth/logout'))  return logoutHandler(req, res);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

// Auto-refresh — 50dk'da bir background refresh (token 60dk geçerli)
function startRefreshLoop() {
  const tick = async () => {
    const env = readEnv();
    if (!env.GOOGLE_REFRESH_TOKEN) return;
    const expiresAt = parseInt(env.GOOGLE_TOKEN_EXPIRES_AT || '0', 10);
    if (Date.now() > expiresAt - 5 * 60_000) {
      const r = await refreshToken().catch(() => ({ ok: false }));
      if (r.ok) console.log('[google-oauth] token refreshed');
    }
  };
  setInterval(tick, 5 * 60_000);
  tick();
}

module.exports = { shouldHandle, handleHttp, refreshToken, readEnv: () => readEnv(), startRefreshLoop };
