/**
 * System utilities API: cliclick install state, reminders watcher control,
 * MCP server log tail.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const http = require('http');
const remindersWatcher = require('./reminders-watcher');
const morningBrief = require('./morning-brief');
const meetingDetector = require('./meeting-detector');
const inboxSweeper = require('./inbox-sweeper');

const CLICLICK_PATHS = ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function cliclickState() {
  for (const p of CLICLICK_PATHS) {
    if (fs.existsSync(p)) return { installed: true, path: p };
  }
  return { installed: false, path: null };
}

function cliclickInstall(res) {
  const cmd = '/opt/homebrew/bin/brew install cliclick';
  exec(cmd, { timeout: 120_000 }, (err, stdout, stderr) => {
    if (err) {
      json(res, 500, { ok: false, error: err.message, stderr: stderr.slice(-500) });
      return;
    }
    json(res, 200, { ok: true, stdout: stdout.slice(-500), state: cliclickState() });
  });
}

const MCP_LOG_DIR = path.join(os.homedir(), '.jarvis', 'logs', 'mcp');

function listMcpLogs() {
  try {
    if (!fs.existsSync(MCP_LOG_DIR)) return [];
    return fs.readdirSync(MCP_LOG_DIR)
      .filter((f) => f.endsWith('.log'))
      .map((f) => {
        const full = path.join(MCP_LOG_DIR, f);
        const st = fs.statSync(full);
        return { name: f.replace(/\.log$/, ''), size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}

function tailMcpLog(name, bytes = 16_384) {
  const safe = String(name).replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safe) return '';
  const full = path.join(MCP_LOG_DIR, `${safe}.log`);
  if (!fs.existsSync(full)) return '';
  const st = fs.statSync(full);
  const start = Math.max(0, st.size - bytes);
  const fd = fs.openSync(full, 'r');
  const buf = Buffer.alloc(st.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString('utf-8');
}

async function handleHttp(req, res) {
  const url = req.url || '';

  if (url === '/api/cliclick/state' && req.method === 'GET') {
    return json(res, 200, cliclickState());
  }
  if (url === '/api/cliclick/install' && req.method === 'POST') {
    return cliclickInstall(res);
  }

  if (url === '/api/reminders-watcher/state' && req.method === 'GET') {
    return json(res, 200, remindersWatcher.getState());
  }
  if (url === '/api/reminders-watcher/toggle' && req.method === 'POST') {
    let body; try { body = await readBody(req); } catch { return json(res, 400, { ok: false }); }
    remindersWatcher.setEnabled(!!body.enabled);
    return json(res, 200, { ok: true, state: remindersWatcher.getState() });
  }

  if (url === '/api/mcp-logs/list' && req.method === 'GET') {
    return json(res, 200, { servers: listMcpLogs() });
  }
  if (url.startsWith('/api/mcp-logs/tail') && req.method === 'GET') {
    const u = new URL(url, 'http://x');
    const name = u.searchParams.get('server') || '';
    const bytes = Number(u.searchParams.get('bytes') || 16384);
    return json(res, 200, { name, content: tailMcpLog(name, bytes) });
  }

  if (url === '/api/morning-brief/state' && req.method === 'GET') {
    return json(res, 200, morningBrief.getConfig());
  }
  if (url === '/api/morning-brief/save' && req.method === 'POST') {
    let body; try { body = await readBody(req); } catch { return json(res, 400, { ok: false }); }
    return json(res, 200, { ok: true, state: morningBrief.setConfig(body) });
  }
  if (url === '/api/morning-brief/send-now' && req.method === 'POST') {
    try {
      const r = await morningBrief.sendNow();
      return json(res, r.ok ? 200 : 502, r);
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (url === '/api/meeting-detector/state' && req.method === 'GET') {
    return json(res, 200, meetingDetector.getConfig());
  }
  if (url === '/api/meeting-detector/save' && req.method === 'POST') {
    let body; try { body = await readBody(req); } catch { return json(res, 400, { ok: false }); }
    return json(res, 200, { ok: true, state: meetingDetector.setConfig(body) });
  }
  if (url === '/api/meeting-detector/fire-now' && req.method === 'POST') {
    try {
      const r = await meetingDetector.fireNow();
      return json(res, r.ok ? 200 : 404, r);
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (url === '/api/inbox-sweeper/state' && req.method === 'GET') {
    return json(res, 200, inboxSweeper.getConfig());
  }
  if (url === '/api/inbox-sweeper/save' && req.method === 'POST') {
    let body; try { body = await readBody(req); } catch { return json(res, 400, { ok: false }); }
    return json(res, 200, { ok: true, state: inboxSweeper.setConfig(body) });
  }
  if (url === '/api/inbox-sweeper/run-now' && req.method === 'POST') {
    try {
      const r = await inboxSweeper.runNow();
      return json(res, 200, r);
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (url === '/api/cost/today' && req.method === 'GET') {
    return proxyAgentMetrics(res);
  }

  res.writeHead(404);
  res.end();
}

function proxyAgentMetrics(res) {
  const port = parseInt(process.env.AGENT_PORT || '8767', 10);
  const req = http.request(
    { host: '127.0.0.1', port, path: '/metrics', method: 'GET', timeout: 1500 },
    (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(Buffer.concat(chunks));
      });
    },
  );
  req.on('error', () => json(res, 502, { error: 'agent unreachable' }));
  req.on('timeout', () => { req.destroy(); json(res, 504, { error: 'timeout' }); });
  req.end();
}

function shouldHandle(url) {
  return url.startsWith('/api/cliclick') ||
         url.startsWith('/api/reminders-watcher') ||
         url.startsWith('/api/mcp-logs') ||
         url.startsWith('/api/morning-brief') ||
         url.startsWith('/api/meeting-detector') ||
         url.startsWith('/api/inbox-sweeper') ||
         url.startsWith('/api/cost');
}

module.exports = { handleHttp, shouldHandle, MCP_LOG_DIR };
