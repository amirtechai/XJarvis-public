/**
 * Computer Use — Anthropic Claude with computer tool (FULL MODE).
 *
 *   GET  /api/computer-use/state    → {enabled, full_mode, blocked_actions}
 *   POST /api/computer-use/toggle   {enabled?, full_mode?}
 *   POST /api/computer-use/run      {goal} → kicks off agent task
 *
 * FULL MODE: agent executes everything autonomously EXCEPT actions in
 * `blocked_actions` (default: anything that deletes/removes/destroys).
 * Those still require explicit user confirmation.
 *
 * The actual desktop control is delegated to a Python sidecar
 * (agent.tools.computer_use) that uses the Anthropic computer tool.
 * This Node module just owns config + dispatch.
 */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '.env');

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
function writeEnv(patch) {
  const env = readEnv();
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) delete env[k];
    else env[k] = String(v);
  }
  fs.writeFileSync(ENV_PATH, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
}

const DEFAULT_BLOCKED = [
  'rm -rf', 'rm ', 'delete', 'shutil.rmtree',
  'drop table', 'truncate', 'format ',
  'shutdown', 'reboot',
  'kill -9', 'pkill -9',
];

function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on('data', (x) => c.push(x));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf-8')));
  });
}

function shouldHandle(url) { return url.startsWith('/api/computer-use'); }

function getState() {
  const env = readEnv();
  return {
    enabled: env.XJARVIS_COMPUTER_USE === '1',
    full_mode: (env.XJARVIS_COMPUTER_USE_FULL || '1') === '1',
    blocked_actions: DEFAULT_BLOCKED,
  };
}

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/computer-use/state') {
      res.writeHead(200); res.end(JSON.stringify({ ok: true, ...getState() }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/computer-use/toggle') {
      const b = JSON.parse((await readBody(req)) || '{}');
      const patch = {};
      if (typeof b.enabled === 'boolean') patch.XJARVIS_COMPUTER_USE = b.enabled ? '1' : '0';
      if (typeof b.full_mode === 'boolean') patch.XJARVIS_COMPUTER_USE_FULL = b.full_mode ? '1' : '0';
      writeEnv(patch);
      res.writeHead(200); res.end(JSON.stringify({ ok: true, ...getState(), restart_required: true }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/computer-use/run') {
      const b = JSON.parse((await readBody(req)) || '{}');
      const goal = String(b.goal || '').trim();
      if (!goal) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'goal required' })); return; }
      const st = getState();
      if (!st.enabled) { res.writeHead(403); res.end(JSON.stringify({ ok: false, error: 'computer use disabled' })); return; }
      // Dispatch as multi-agent run — actual execution lives in Python sidecar
      // (agent/tools/computer_use.py — build separately).
      const agentsRuns = require('./agents-runs');
      const run = agentsRuns.spawn({ pipeline: 'computer-use', prompt: goal });
      res.writeHead(200); res.end(JSON.stringify({ ok: true, run_id: run.id, full_mode: st.full_mode }));
      return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle, DEFAULT_BLOCKED };
