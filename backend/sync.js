/**
 * Multi-machine sync (MVP) — primary makinedeki KnowledgeStore'u secondary
 * makinelere pull-style replicate eder.
 *
 * Mimari:
 *   • Primary (varsayılan): tüm connector sync'lerini yapar, KnowledgeStore'u
 *     besler, /api/sync/* endpoint'lerini açar.
 *   • Secondary: SYNC_PRIMARY_URL ve SYNC_TOKEN env değişkenlerini set eder.
 *     Belirli aralıklarla primary'den `?since=<iso>` ile son Document'leri çeker
 *     ve lokal KnowledgeStore'a yazar. Connector sync'lerini kendisi yapmaz.
 *
 * Auth: shared secret token (XJARVIS_SYNC_TOKEN). Production-grade JWT değil ama
 * lokal LAN ya da tailscale gibi bir overlay ağ üzerinde yeterli.
 *
 * Endpoints (primary):
 *   GET  /api/sync/health              → token doğrula, "ok"
 *   GET  /api/sync/knowledge?since=...  → JSON array of Documents (since ISO)
 *   POST /api/sync/knowledge           → secondary'den primary'ye push (ileride)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');

const PYTHON = process.env.PYTHON_BIN || 'python3';
const PYHELPER = path.join(__dirname, 'sync-knowledge.py');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function getToken() {
  return (process.env.XJARVIS_SYNC_TOKEN || '').trim();
}

function authOk(req) {
  const expected = getToken();
  if (!expected) return false;
  const h = req.headers.authorization || '';
  return h === `Bearer ${expected}`;
}

// ---------------------------------------------------------------------------
// Primary side — serve knowledge from local store
// ---------------------------------------------------------------------------
function fetchSinceFromStore(sinceEpoch, limit = 1000) {
  return new Promise((resolve) => {
    const args = JSON.stringify({ since_epoch: Number(sinceEpoch) || 0, limit });
    const proc = spawn(PYTHON, [PYHELPER, 'export', args], {
      env: { ...process.env, PYTHONPATH: process.env.OPENJARVIS_SRC || '' },
    });
    let out = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('close', () => {
      try { resolve(JSON.parse(out || '{"chunks":[]}')); }
      catch { resolve({ chunks: [], max_created_at: sinceEpoch }); }
    });
    setTimeout(() => { try { proc.kill(); } catch {} resolve({ chunks: [], max_created_at: sinceEpoch }); }, 60_000);
  });
}

function importIntoStore(payload) {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, [PYHELPER, 'import'], {
      env: { ...process.env, PYTHONPATH: process.env.OPENJARVIS_SRC || '' },
    });
    let out = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.stdin.write(JSON.stringify(payload)); proc.stdin.end();
    proc.on('close', () => { try { resolve(JSON.parse(out || '{}')); } catch { resolve({ ok: false }); } });
    setTimeout(() => { try { proc.kill(); } catch {} resolve({ ok: false, error: 'timeout' }); }, 120_000);
  });
}

// ---------------------------------------------------------------------------
// Secondary side — pull from primary periodically
// ---------------------------------------------------------------------------
const STATE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'sync-state.json');
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')); } catch { return {}; }
}
function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function fetchFromPrimary(sinceEpoch) {
  const url = process.env.SYNC_PRIMARY_URL;
  const token = process.env.SYNC_TOKEN;
  if (!url || !token) return Promise.resolve(null);
  const lib = url.startsWith('https') ? https : http;
  const target = `${url.replace(/\/+$/, '')}/api/sync/knowledge?since_epoch=${encodeURIComponent(sinceEpoch)}`;
  return new Promise((resolve) => {
    lib.get(target, { headers: { Authorization: `Bearer ${token}` }, timeout: 120_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

let pullTimer = null;
async function pullTick() {
  const state = readState();
  const sinceEpoch = state.last_created_at || 0;
  const payload = await fetchFromPrimary(sinceEpoch);
  if (!payload || !Array.isArray(payload.chunks)) {
    console.warn('[sync] primary returned bad payload; check token/URL');
    return;
  }
  if (payload.chunks.length === 0) return;
  const r = await importIntoStore(payload);
  state.last_created_at = payload.max_created_at || sinceEpoch;
  state.last_sync = new Date().toISOString();
  state.last_imported = (state.last_imported || 0) + (r.imported || 0);
  state.last_skipped = (state.last_skipped || 0) + (r.skipped || 0);
  writeState(state);
  console.log(`[sync] pulled ${payload.chunks.length} chunks (imported=${r.imported}, skipped=${r.skipped})`);
}

function start() {
  // Only run pull loop on secondaries (i.e. when SYNC_PRIMARY_URL is set)
  if (!process.env.SYNC_PRIMARY_URL || !process.env.SYNC_TOKEN) {
    console.log('[sync] running as primary (no SYNC_PRIMARY_URL set)');
    return;
  }
  if (pullTimer) clearInterval(pullTimer);
  pullTimer = setInterval(() => pullTick().catch(() => {}), 5 * 60_000);
  setTimeout(() => pullTick().catch(() => {}), 10_000);
  console.log(`[sync] running as secondary, pulling from ${process.env.SYNC_PRIMARY_URL} every 5min`);
}

// ---------------------------------------------------------------------------
// HTTP routing
// ---------------------------------------------------------------------------
function shouldHandle(url) { return url.startsWith('/api/sync'); }
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (!getToken()) {
    res.writeHead(503); res.end(JSON.stringify({ error: 'XJARVIS_SYNC_TOKEN not set on primary' })); return;
  }
  if (!authOk(req)) {
    res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return;
  }

  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/sync/health') {
    res.writeHead(200); res.end(JSON.stringify({ ok: true, role: process.env.SYNC_PRIMARY_URL ? 'secondary' : 'primary' })); return;
  }

  if (req.method === 'GET' && url.pathname === '/api/sync/knowledge') {
    const sinceEpoch = parseFloat(url.searchParams.get('since_epoch') || '0');
    const limit = parseInt(url.searchParams.get('limit') || '1000', 10);
    const payload = await fetchSinceFromStore(sinceEpoch, limit);
    res.writeHead(200); res.end(JSON.stringify(payload)); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/knowledge') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{"chunks":[]}');
        const r = await importIntoStore(payload);
        res.writeHead(200); res.end(JSON.stringify(r));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { start, shouldHandle, handleHttp };
