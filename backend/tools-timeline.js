/**
 * Tool-call live timeline.
 *   GET  /api/tools/timeline?since=ts → recent tool calls
 *   POST /api/tools/timeline {name, args, started_at, finished_at, ok, output}
 *
 * The Python agent (xjarvis_agent) emits events via the bus when a tool runs.
 * This module also accepts direct POSTs for any other tooling integration.
 */
const { bus, EVENT_TYPES } = require('./events/bus');

const MAX_ENTRIES = 200;
let entries = [];

bus.on(EVENT_TYPES.TOOL_CALL_START, (payload) => {
  entries.push({
    id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: payload.name || 'unknown',
    args: payload.args || {},
    started_at: Date.now(),
    finished_at: null,
    ok: null,
  });
  entries = entries.slice(-MAX_ENTRIES);
});

bus.on(EVENT_TYPES.TOOL_CALL_END, (payload) => {
  // Find latest entry with same name and missing finished_at
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.name === payload.name && e.finished_at == null) {
      e.finished_at = Date.now();
      e.ok = payload.ok !== false;
      e.output_brief = String(payload.output || '').slice(0, 200);
      break;
    }
  }
});

function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on('data', (x) => c.push(x));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf-8')));
  });
}

function shouldHandle(url) { return url.startsWith('/api/tools/'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/tools/timeline') {
      const since = parseInt(u.searchParams.get('since') || '0', 10);
      const filtered = entries.filter((e) => e.started_at > since);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, entries: filtered.slice(-100) }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/tools/timeline') {
      const b = JSON.parse((await readBody(req)) || '{}');
      entries.push({
        id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: String(b.name || 'unknown').slice(0, 60),
        args: b.args || {},
        started_at: b.started_at || Date.now(),
        finished_at: b.finished_at || Date.now(),
        ok: b.ok !== false,
        output_brief: String(b.output || '').slice(0, 200),
      });
      entries = entries.slice(-MAX_ENTRIES);
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle };
