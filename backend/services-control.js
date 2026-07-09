/**
 * Service control API — XJarvis'in 5 alt-sistemini aç/kapa/durum.
 *
 *   GET  /api/services/state                 → her servis için {running, type}
 *   POST /api/services/start  body:{name}    → tek bir servisi başlat
 *   POST /api/services/stop   body:{name}    → tek bir servisi durdur
 *   POST /api/services/start-all             → eksik olanları başlat (idempotent)
 *
 * Servis listesi:
 *   - voice    (launchd com.jarvis.voice)
 *   - vision   (launchd com.jarvis.vision)
 *   - agent    (python -m agent.service, port 8767)
 *   - backend  (kendisi — durduramaz, sadece durum gösterir)
 *   - ui       (Tauri uygulaması — launchctl ile değil, sadece durum)
 */
const { execFile, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const LOGS = path.join(ROOT, 'logs');

const UID = process.getuid();
const launchdLabel = (svc) => `com.jarvis.${svc}`;
const launchdTarget = (svc) => `gui/${UID}/${launchdLabel(svc)}`;

function execAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', err });
    });
  });
}

async function isProcessRunning(grepPattern) {
  const r = await execAsync('/bin/sh', ['-c', `pgrep -fl "${grepPattern}" || true`]);
  return (r.stdout || '').trim().length > 0;
}

async function isPortListening(port) {
  // Absolute path: backend launchd PATH omits /usr/sbin where lsof lives,
  // so a bare `lsof` call silently fails and every service looks "down".
  const r = await execAsync('/bin/sh', ['-c', `/usr/sbin/lsof -nP -i TCP:${port} -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -1`]);
  return (r.stdout || '').trim().length > 0;
}

async function getState() {
  // Backend kendisini de pgrep ile aramaya çalışınca yanlış cevap veriyordu.
  // Port-bazlı kontrol daha güvenilir + lsof her durumda çalışır.
  const [voice, vision, agent, backend, ui] = await Promise.all([
    isPortListening(8766),               // voice.service
    isPortListening(8765),               // vision.service
    isPortListening(8767),               // agent.service
    isPortListening(3001),               // backend
    isProcessRunning('XJarvis\\.app'),   // tauri UI
  ]);
  return {
    services: [
      { name: 'voice',   label: 'Voice (mic + wake + STT + TTS)', running: voice,   type: 'launchd' },
      { name: 'vision',  label: 'Vision (kamera)',                running: vision,  type: 'launchd' },
      { name: 'agent',   label: 'Agent (LLM)',                    running: agent,   type: 'python'  },
      { name: 'backend', label: 'Backend (port 3001)',            running: backend, type: 'node', readonly: true },
      { name: 'ui',      label: 'XJarvis.app (UI penceresi)',      running: ui,      type: 'tauri',  readonly: true },
    ],
  };
}

async function startService(name) {
  if (name === 'voice' || name === 'vision') {
    const target = launchdTarget(name);
    const port = name === 'voice' ? 8766 : 8765;
    const plist = `${process.env.HOME}/Library/LaunchAgents/${launchdLabel(name)}.plist`;
    if (!fs.existsSync(plist)) return { ok: false, error: `${plist} bulunamadı` };
    const dom = `gui/${UID}`;
    // Önce bootstrap (yüklü değilse yükler; yüklüyse "already loaded" döner — sorun değil)
    await execAsync('launchctl', ['bootstrap', dom, plist]);
    // Sonra kickstart (var olan serviste restart, yeni yüklenende start eder)
    const kick = await execAsync('launchctl', ['kickstart', '-k', target]);
    // Port dinlemeye başlayana kadar 6sn poll
    for (let i = 0; i < 12; i++) {
      await new Promise((res) => setTimeout(res, 500));
      if (await isPortListening(port)) return { ok: true };
    }
    return { ok: false, error: 'started but port not listening', stderr: kick.stderr };
  }
  if (name === 'agent') {
    const log = path.join(LOGS, 'agent.log');
    const out = fs.openSync(log, 'a');
    const child = spawn('python3', ['-m', 'agent.service'], {
      cwd: ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
    child.on('exit', () => {
      try { fs.closeSync(out); } catch {}
    });
    return { ok: true, pid: child.pid };
  }
  return { ok: false, error: `start desteklenmeyen servis: ${name}` };
}

async function stopService(name) {
  const port = name === 'voice' ? 8766 : name === 'vision' ? 8765 : name === 'agent' ? 8767 : null;
  if (name === 'voice' || name === 'vision') {
    // Try launchd first (clean stop with KeepAlive disabled mid-flight).
    const target = launchdTarget(name);
    await execAsync('launchctl', ['bootout', target]);
    // Fallback — if the service was started manually (nohup), bootout is a
    // no-op. Kill anything still listening on the port.
    await execAsync('/bin/sh', ['-c', `pkill -f 'voice\\.service' || true`]);
    if (name === 'vision') await execAsync('/bin/sh', ['-c', `pkill -f 'vision\\.' || true`]);
    // Confirm port is free.
    for (let i = 0; i < 10; i++) {
      await new Promise((res) => setTimeout(res, 300));
      if (port && !(await isPortListening(port))) return { ok: true };
    }
    return { ok: false, error: 'still listening after stop' };
  }
  if (name === 'agent') {
    await execAsync('/bin/sh', ['-c', "pkill -f 'agent\\.service' || true"]);
    for (let i = 0; i < 10; i++) {
      await new Promise((res) => setTimeout(res, 300));
      if (!(await isPortListening(8767))) return { ok: true };
    }
    return { ok: false, error: 'still listening after stop' };
  }
  return { ok: false, error: `stop desteklenmeyen servis: ${name}` };
}

async function startMissing() {
  const s = await getState();
  const results = [];
  for (const svc of s.services) {
    if (svc.readonly) continue;
    if (!svc.running) {
      const r = await startService(svc.name);
      results.push({ name: svc.name, ...r });
    }
  }
  return { ok: true, started: results };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function shouldHandle(url) { return url.startsWith('/api/services/'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/services/state') {
      res.writeHead(200); res.end(JSON.stringify(await getState())); return;
    }
    if (req.method === 'POST' && u.pathname === '/api/services/start') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await startService((body.name || '').toLowerCase());
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && u.pathname === '/api/services/stop') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await stopService((body.name || '').toLowerCase());
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && u.pathname === '/api/services/start-all') {
      const r = await startMissing();
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle, getState, startService, stopService, startMissing };
