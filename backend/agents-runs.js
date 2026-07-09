/**
 * Multi-agent pipeline run tracker (in-memory + JSONL persistence).
 *
 *   GET    /api/agents/runs            → all runs
 *   POST   /api/agents/runs            {pipeline, prompt} → spawn new run (returns id)
 *   PATCH  /api/agents/runs/:id        {stage, log_chunk, tokens_in, tokens_out, cost_usd}
 *   DELETE /api/agents/runs/:id        → kill (mark failed)
 *
 * The actual agent dispatch is delegated to whatever orchestrator the user
 * wires up (e.g. autonomous-dev sub-agent). This module just stores state.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'agent-runs.json');
const MAX_RUNS = 100;

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) || [];
  } catch { return []; }
}
function saveStore(runs) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(runs.slice(-MAX_RUNS), null, 2));
  } catch { /* noop */ }
}

let runs = loadStore();

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function spawn({ pipeline = 'planner-coder-reviewer-tester', prompt = '' } = {}) {
  const run = {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pipeline,
    stage: 'planner',
    prompt: String(prompt).slice(0, 600),
    started_at: Date.now(),
    cost_usd: 0,
    tokens_in: 0,
    tokens_out: 0,
    log_tail: [],
  };
  runs.push(run);
  saveStore(runs);
  return run;
}

function update(id, patch) {
  const run = runs.find((r) => r.id === id);
  if (!run) return null;
  if (patch.stage) run.stage = patch.stage;
  if (typeof patch.cost_usd === 'number') run.cost_usd = (run.cost_usd || 0) + patch.cost_usd;
  if (typeof patch.tokens_in === 'number') run.tokens_in = (run.tokens_in || 0) + patch.tokens_in;
  if (typeof patch.tokens_out === 'number') run.tokens_out = (run.tokens_out || 0) + patch.tokens_out;
  if (typeof patch.log_chunk === 'string') {
    run.log_tail = [...(run.log_tail || []), patch.log_chunk].slice(-30);
  }
  if (patch.stage === 'done' || patch.stage === 'failed') {
    run.finished_at = Date.now();
  }
  saveStore(runs);
  return run;
}

function kill(id) {
  const run = runs.find((r) => r.id === id);
  if (!run) return null;
  if (run.stage === 'done' || run.stage === 'failed') return run;
  run.stage = 'failed';
  run.finished_at = Date.now();
  saveStore(runs);
  return run;
}

function shouldHandle(url) { return url.startsWith('/api/agents/'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/agents/runs') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, runs: runs.slice(-50).reverse() }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/agents/runs') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const run = spawn(body);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, run }));
      return;
    }
    const m = u.pathname.match(/^\/api\/agents\/runs\/([\w-]+)$/);
    if (m && req.method === 'PATCH') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = update(m[1], body);
      res.writeHead(r ? 200 : 404);
      res.end(JSON.stringify(r ? { ok: true, run: r } : { ok: false, error: 'not found' }));
      return;
    }
    if (m && req.method === 'DELETE') {
      const r = kill(m[1]);
      res.writeHead(r ? 200 : 404);
      res.end(JSON.stringify(r ? { ok: true } : { ok: false, error: 'not found' }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle, spawn, update, kill };
