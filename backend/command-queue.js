/**
 * Remote command queue — used by xjarvis.your-domain.example (mobile/web companion).
 *
 *   POST /api/queue/push       {goal, source, requires_approval?, secret} → enqueue
 *   GET  /api/queue/pending    → list pending (for mac to pick up on wake)
 *   POST /api/queue/ack/:id    {result, status: 'done'|'approved'|'rejected'}
 *   GET  /api/queue/recent?limit=20
 *
 * Authentication: simple shared-secret header `X-XJarvis-Token` matched against
 * env `XJARVIS_REMOTE_TOKEN`. If env not set, falls back to localhost-only access.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'command-queue.json');

function loadQueue() {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) || [];
  } catch { return []; }
}
function saveQueue(items) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(items.slice(-200), null, 2));
  } catch { /* noop */ }
}

let queue = loadQueue();

function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on('data', (x) => c.push(x));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf-8')));
  });
}

function isAuthorized(req) {
  const token = (req.headers['x-xjarvis-token'] || '').toString().trim();
  const expected = (process.env.XJARVIS_REMOTE_TOKEN || '').trim();
  if (!expected) {
    // No token configured → allow only same-host requests
    const host = (req.headers.host || '').split(':')[0];
    return host === 'localhost' || host === '127.0.0.1';
  }
  return token === expected;
}

function shouldHandle(url) { return url.startsWith('/api/queue'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-XJarvis-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (!isAuthorized(req)) {
    res.writeHead(401);
    res.end(JSON.stringify({ ok: false, error: 'unauthorized — set XJARVIS_REMOTE_TOKEN' }));
    return;
  }

  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && u.pathname === '/api/queue/push') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const item = {
        id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        goal: String(body.goal || '').slice(0, 1000),
        source: String(body.source || 'remote'),
        requires_approval: body.requires_approval !== false,
        status: 'pending',
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      if (!item.goal) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'goal required' })); return; }
      queue.push(item);
      saveQueue(queue);
      res.writeHead(200); res.end(JSON.stringify({ ok: true, item }));
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/queue/pending') {
      const pending = queue.filter((q) => q.status === 'pending');
      res.writeHead(200); res.end(JSON.stringify({ ok: true, items: pending }));
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/queue/recent') {
      const limit = parseInt(u.searchParams.get('limit') || '20', 10);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, items: queue.slice(-limit).reverse() }));
      return;
    }
    const m = u.pathname.match(/^\/api\/queue\/ack\/([\w-]+)$/);
    if (m && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const item = queue.find((q) => q.id === m[1]);
      if (!item) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'not found' })); return; }
      item.status = ['approved', 'rejected', 'done', 'failed'].includes(body.status) ? body.status : 'done';
      item.result = String(body.result || '').slice(0, 500);
      item.updated_at = Date.now();
      saveQueue(queue);
      res.writeHead(200); res.end(JSON.stringify({ ok: true, item }));
      return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle, queue };
