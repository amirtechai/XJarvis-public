/**
 * Aggregate health endpoint — single GET for the /health UI page.
 *
 *   GET /api/health/all → {
 *     services: { backend, agent, voice, vision }
 *     watchers: { telegram, reminders, morning_brief, meeting_detector, inbox_sweeper }
 *     mcp:      [{ name, mtime_age_sec, fresh }],
 *     keys:     { TOGETHER_API_KEY, ... }
 *   }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const remindersWatcher = require('./reminders-watcher');
const morningBrief = require('./morning-brief');
const meetingDetector = require('./meeting-detector');
const inboxSweeper = require('./inbox-sweeper');
const telegram = require('./telegram');

const MCP_LOG_DIR = path.join(os.homedir(), '.jarvis', 'logs', 'mcp');
const ENV_PATH = path.join(__dirname, '.env');

function probe(url, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        try {
          resolve({
            up: res.statusCode === 200,
            body: Buffer.concat(cs).toString('utf-8'),
          });
        } catch { resolve({ up: false }); }
      });
    });
    req.on('error', () => resolve({ up: false }));
    req.on('timeout', () => { req.destroy(); resolve({ up: false }); });
    req.end();
  });
}

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function listMcp() {
  try {
    if (!fs.existsSync(MCP_LOG_DIR)) return [];
    const now = Date.now();
    return fs.readdirSync(MCP_LOG_DIR)
      .filter((f) => f.endsWith('.log'))
      .map((f) => {
        const full = path.join(MCP_LOG_DIR, f);
        const st = fs.statSync(full);
        const ageSec = Math.round((now - st.mtimeMs) / 1000);
        return {
          name: f.replace(/\.log$/, ''),
          mtime_age_sec: ageSec,
          // fresh if log was touched in the last 10 min
          fresh: ageSec < 600,
          size: st.size,
        };
      })
      .sort((a, b) => a.mtime_age_sec - b.mtime_age_sec);
  } catch { return []; }
}

async function aggregate() {
  const env = readEnv();
  const [agent, voice, vision, agentMetrics] = await Promise.all([
    probe('http://127.0.0.1:8767/health'),
    probe('http://127.0.0.1:8766/status'),
    probe('http://127.0.0.1:8765/status'),
    probe('http://127.0.0.1:8767/metrics'),
  ]);
  let metrics = null;
  try { metrics = agentMetrics.up ? JSON.parse(agentMetrics.body) : null; } catch {}

  const tg = (typeof telegram.getState === 'function') ? telegram.getState() : null;
  const tgUp = !!(tg && tg.connected);

  return {
    timestamp: Date.now() / 1000,
    services: {
      backend: { up: true },
      agent: { up: agent.up, port: 8767 },
      voice: { up: voice.up, port: 8766 },
      vision: { up: vision.up, port: 8765 },
    },
    metrics: metrics ? {
      spend_usd_today: metrics.spend_usd_today,
      daily_cap_usd: metrics.daily_cap_usd,
      tools_count: metrics.tools_count,
      latency_p50_ms: metrics.latency_60min?.total_p50,
      latency_p95_ms: metrics.latency_60min?.total_p95,
      ttft_p50_ms: metrics.latency_60min?.ttft_p50,
    } : null,
    watchers: {
      telegram: { up: tgUp, ...(tg || {}) },
      reminders: remindersWatcher.getState(),
      morning_brief: morningBrief.getConfig(),
      meeting_detector: meetingDetector.getConfig(),
      inbox_sweeper: inboxSweeper.getConfig(),
    },
    mcp: listMcp(),
    keys: {
      TOGETHER_API_KEY: !!env.TOGETHER_API_KEY,
      DEEPGRAM_API_KEY: !!env.DEEPGRAM_API_KEY,
      OPENAI_API_KEY: !!env.OPENAI_API_KEY,
      PICOVOICE_ACCESS_KEY: !!env.PICOVOICE_ACCESS_KEY,
    },
  };
}

async function handleHttp(req, res) {
  if (req.url === '/api/health/all' && req.method === 'GET') {
    const data = await aggregate();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }
  return null;
}

function shouldHandle(url) {
  return url.startsWith('/api/health/');
}

module.exports = { handleHttp, shouldHandle };
