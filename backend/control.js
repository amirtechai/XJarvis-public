/**
 * System control endpoints — called from the Tauri tray.
 *
 *   GET  /api/control/state      → { camera, mic, jarvis, volume }
 *   POST /api/control/camera     { on?: bool, toggle?: true }
 *   POST /api/control/mic        { on?: bool, toggle?: true }
 *   POST /api/control/jarvis     { on?: bool, toggle?: true }
 *   POST /api/control/volume     { level: 0-100 }  OR  { delta: -10..+10 }
 */
const http = require('http');
const { exec } = require('child_process');
const { setJarvisOn, isJarvisOn } = require('./router');

const VISION_BASE = 'http://127.0.0.1:8765';
const VOICE_BASE  = 'http://127.0.0.1:8766';

function readJson(req) {
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

function fwd(method, url, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers, timeout: 3000 },
      (res) => {
        const cs = [];
        res.on('data', (c) => cs.push(c));
        res.on('end', () => {
          try { resolve({ ok: res.statusCode === 200, data: JSON.parse(Buffer.concat(cs).toString() || '{}') }); }
          catch { resolve({ ok: false, data: {} }); }
        });
      },
    );
    req.on('error', () => resolve({ ok: false, data: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, data: {} }); });
    if (payload) req.write(payload);
    req.end();
  });
}

function execShell(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 3000 }, (err, stdout) => {
      resolve({ ok: !err, stdout: (stdout || '').trim() });
    });
  });
}

async function getVolume() {
  const r = await execShell(`osascript -e 'output volume of (get volume settings)'`);
  const n = parseInt(r.stdout, 10);
  return Number.isFinite(n) ? n : null;
}

async function setVolume(level) {
  const v = Math.max(0, Math.min(100, Math.round(level)));
  await execShell(`osascript -e 'set volume output volume ${v}'`);
  return v;
}

async function stateHandler(req, res) {
  const [vision, voice, vol] = await Promise.all([
    fwd('GET', `${VISION_BASE}/camera/state`),
    fwd('GET', `${VOICE_BASE}/status`),
    getVolume(),
  ]);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    camera: { on: vision.data.on === true, available: vision.ok },
    mic:    { on: voice.data.mic_on !== false, available: voice.ok },
    jarvis: { on: isJarvisOn(), available: true },
    volume: vol,
  }));
}

async function cameraHandler(req, res) {
  let body; try { body = await readJson(req); } catch { res.writeHead(400); res.end(); return; }
  const targetOn = 'on' in body ? !!body.on : null;
  let endpoint;
  if (targetOn === null) {
    // toggle: query state then flip
    const cur = await fwd('GET', `${VISION_BASE}/camera/state`);
    endpoint = cur.data.on ? '/camera/off' : '/camera/on';
  } else {
    endpoint = targetOn ? '/camera/on' : '/camera/off';
  }
  const r = await fwd('POST', `${VISION_BASE}${endpoint}`);
  res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: r.ok, on: r.data.on === true }));
}

async function micHandler(req, res) {
  let body; try { body = await readJson(req); } catch { res.writeHead(400); res.end(); return; }
  const r = await fwd('POST', `${VOICE_BASE}/mic/set`, body);
  res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: r.ok, on: r.data.on === true }));
}

async function jarvisHandler(req, res) {
  let body; try { body = await readJson(req); } catch { res.writeHead(400); res.end(); return; }
  const target = 'on' in body ? !!body.on : !isJarvisOn();
  setJarvisOn(target);
  // Also propagate to voice service so wake-word stops chime+STT
  await fwd('POST', `${VOICE_BASE}/jarvis/set`, { on: target });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, on: target }));
}

async function volumeHandler(req, res) {
  let body; try { body = await readJson(req); } catch { res.writeHead(400); res.end(); return; }
  let next;
  if (typeof body.level === 'number') {
    next = await setVolume(body.level);
  } else if (typeof body.delta === 'number') {
    const cur = await getVolume();
    next = await setVolume((cur ?? 50) + body.delta);
  } else {
    res.writeHead(400);
    res.end(JSON.stringify({ ok: false, error: 'level or delta required' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, volume: next }));
}

async function historyProxyHandler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const target = `http://127.0.0.1:8767/history${url.search || ''}`;
  const r = await fwd(req.method, target);
  res.writeHead(r.ok ? 200 : (r.data?.error ? 502 : 502), { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(r.data));
}

async function toolCallsProxyHandler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const target = `http://127.0.0.1:8767/tool_calls${url.search || ''}`;
  const r = await fwd('GET', target);
  res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(r.data));
}

function fwdLong(method, url, body, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers, timeout: timeoutMs },
      (res) => {
        const cs = [];
        res.on('data', (c) => cs.push(c));
        res.on('end', () => {
          try { resolve({ ok: res.statusCode === 200, data: JSON.parse(Buffer.concat(cs).toString() || '{}') }); }
          catch { resolve({ ok: false, data: { error: 'parse' } }); }
        });
      },
    );
    req.on('error', (e) => resolve({ ok: false, data: { error: e.message } }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, data: { error: 'timeout' } }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function approvalsListProxyHandler(req, res) {
  const r = await fwd('GET', 'http://127.0.0.1:8767/approvals');
  res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(r.data));
}

async function approvalsDecideProxyHandler(req, res) {
  let body; try { body = await readJson(req); } catch { res.writeHead(400); res.end(); return; }
  const r = await fwd('POST', 'http://127.0.0.1:8767/approvals/decide', body);
  res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(r.data));
}

async function replayProxyHandler(req, res) {
  let body; try { body = await readJson(req); } catch { res.writeHead(400); res.end(); return; }
  const r = await fwdLong('POST', 'http://127.0.0.1:8767/replay', body, 120000);
  res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(r.data));
}

function handleHttp(req, res) {
  if (req.url.startsWith('/api/agent/history')) return historyProxyHandler(req, res);
  if (req.url.startsWith('/api/agent/tool_calls')) return toolCallsProxyHandler(req, res);
  if (req.url.startsWith('/api/agent/replay') && req.method === 'POST') return replayProxyHandler(req, res);
  if (req.url.startsWith('/api/agent/approvals') && req.method === 'GET') return approvalsListProxyHandler(req, res);
  if (req.url.startsWith('/api/agent/approvals/decide') && req.method === 'POST') return approvalsDecideProxyHandler(req, res);
  if (!req.url.startsWith('/api/control/')) return null;
  if (req.method === 'GET' && req.url === '/api/control/state') return stateHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/control/camera') return cameraHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/control/mic')    return micHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/control/jarvis') return jarvisHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/control/volume') return volumeHandler(req, res);
  res.writeHead(404);
  res.end();
  return undefined;
}

module.exports = { handleHttp };
