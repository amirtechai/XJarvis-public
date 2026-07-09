/**
 * Replay buffer — last 24h dashboard snapshots.
 *
 * Tracks a small set of metrics every 60s and stores them in a ring buffer
 * (~1440 entries = 24h). UI replays them as a scrubbable timeline.
 *
 *   GET /api/replay/timeline?since=ts  → all snapshots after ts
 *   GET /api/replay/now                → latest snapshot
 *
 * Snapshot fields: voice_state, response_count, tool_count, cost_today,
 * markets_top1, headline_top1, weather, agent_running.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { bus, EVENT_TYPES } = require('./events/bus');

const STORE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'replay.jsonl');
const MAX_ENTRIES = 24 * 60; // 24h @ 1min

let snapshots = [];
let counters = { responses: 0, tools: 0 };

bus.on(EVENT_TYPES.RESPONSE_END, () => { counters.responses++; });
bus.on(EVENT_TYPES.TOOL_CALL_END, () => { counters.tools++; });

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const lines = fs.readFileSync(STORE_PATH, 'utf-8').trim().split('\n').slice(-MAX_ENTRIES);
    snapshots = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { /* noop */ }
}

function appendStore(entry) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.appendFileSync(STORE_PATH, JSON.stringify(entry) + '\n');
  } catch { /* noop */ }
}

function fetchAgentMetrics() {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 8767, path: '/metrics', timeout: 1500 }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(cs).toString())); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null)).on('timeout', function () { this.destroy(); resolve(null); });
  });
}

async function snapshot() {
  const m = await fetchAgentMetrics();
  const entry = {
    ts: Date.now(),
    voice_state: 'idle', // best-effort — not tracked here
    responses: counters.responses,
    tools: counters.tools,
    cost_today: m ? Number(m.spend_usd_today || 0) : 0,
    agent_running: !!m,
  };
  // Reset deltas
  counters = { responses: 0, tools: 0 };
  snapshots.push(entry);
  if (snapshots.length > MAX_ENTRIES) snapshots = snapshots.slice(-MAX_ENTRIES);
  appendStore(entry);
}

let timer = null;
function start() {
  loadStore();
  if (timer) clearInterval(timer);
  timer = setInterval(() => { snapshot().catch(() => {}); }, 60_000);
  console.log('[replay] buffer started');
}

function shouldHandle(url) { return url.startsWith('/api/replay/'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/replay/timeline') {
    const since = parseInt(u.searchParams.get('since') || '0', 10);
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      entries: snapshots.filter((s) => s.ts > since),
      count: snapshots.length,
    }));
    return;
  }
  if (u.pathname === '/api/replay/now') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, latest: snapshots[snapshots.length - 1] || null }));
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { start, shouldHandle, handleHttp };
