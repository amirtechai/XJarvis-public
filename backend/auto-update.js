/**
 * XJarvis auto-update check.
 *
 *   GET  /api/update/check    → {current, latest, has_update, release_notes_url}
 *   POST /api/update/install  → triggers `npm run release` in background
 *
 * Uses GitHub releases for amirtechai/XJarvis-public as source of truth.
 */
const https = require('https');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO = process.env.XJARVIS_REPO || 'amirtechai/XJarvis-public';
const PKG_PATH = path.join(__dirname, '..', 'package.json');

function currentVersion() {
  try { return JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
}

function fetchLatestRelease() {
  return new Promise((resolve) => {
    const req = https.request({
      method: 'GET', host: 'api.github.com', path: `/repos/${REPO}/releases/latest`,
      headers: { 'User-Agent': 'XJarvis', Accept: 'application/vnd.github+json' },
      timeout: 10_000,
    }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(cs).toString());
          resolve({
            ok: res.statusCode === 200,
            tag: j.tag_name || '',
            url: j.html_url || '',
            published: j.published_at || '',
            notes: (j.body || '').slice(0, 1500),
          });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

function compareSemver(a, b) {
  const norm = (v) => v.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const A = norm(a), B = norm(b);
  for (let i = 0; i < 3; i++) {
    if ((A[i] || 0) > (B[i] || 0)) return 1;
    if ((A[i] || 0) < (B[i] || 0)) return -1;
  }
  return 0;
}

function shouldHandle(url) { return url.startsWith('/api/update/'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/api/update/check') {
    const cur = currentVersion();
    const latest = await fetchLatestRelease();
    if (!latest.ok) {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: false, current: cur, latest: null, error: latest.error }));
      return;
    }
    const has_update = compareSemver(latest.tag, cur) > 0;
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true, current: cur, latest: latest.tag, has_update,
      release_notes_url: latest.url, published: latest.published, notes: latest.notes,
    }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/update/install') {
    const repoRoot = path.join(__dirname, '..');
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, message: 'background pull + release started' }));
    // Fire and forget
    execFile('git', ['pull'], { cwd: repoRoot, timeout: 60_000 }, (err) => {
      if (err) return console.warn('[update] git pull failed:', err.message);
      execFile('npm', ['run', 'release'], { cwd: repoRoot, timeout: 600_000 }, (err2) => {
        if (err2) console.warn('[update] release failed:', err2.message);
        else console.log('[update] release complete');
      });
    });
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { handleHttp, shouldHandle, currentVersion };
