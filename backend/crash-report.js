/**
 * Crash report — launchctl service durumu (exit code, PID, stdout/err log tail)
 * + "diagnose blob" oluştur, dosyaya yaz / clipboard'a kopyala.
 *
 * Endpoints:
 *   GET  /api/crash/state              → her servis için { label, pid, last_exit, error_tail }
 *   POST /api/crash/report             → diagnose blob'u dosyaya yazar, path döner
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const LOG_DIR = path.join(os.homedir(), '.jarvis', 'logs');
const REPORTS_DIR = path.join(os.homedir(), '.jarvis', 'reports');

const LABELS = ['com.jarvis.ui', 'com.jarvis.vision', 'com.jarvis.voice'];

function execP(cmd, timeoutMs = 4000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function inspectLabel(label) {
  // `launchctl list <label>` returns plist-ish text on macOS
  const r = await execP(`launchctl list ${label}`);
  if (!r.ok || !r.stdout) {
    return { label, installed: false };
  }
  const text = r.stdout;
  const pidMatch = text.match(/"PID"\s*=\s*(\d+);/);
  const lastExitMatch = text.match(/"LastExitStatus"\s*=\s*(-?\d+);/);
  const pid = pidMatch ? parseInt(pidMatch[1], 10) : null;
  const lastExit = lastExitMatch ? parseInt(lastExitMatch[1], 10) : null;

  // Best-effort tail of the error log
  const shortName = label.replace('com.jarvis.', '');
  const errLog = path.join(LOG_DIR, `${shortName}-error.log`);
  let errorTail = '';
  let errorMtime = null;
  let errorSize = 0;
  try {
    if (fs.existsSync(errLog)) {
      const st = fs.statSync(errLog);
      errorMtime = st.mtimeMs;
      errorSize = st.size;
      const start = Math.max(0, st.size - 8192);
      const fd = fs.openSync(errLog, 'r');
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      errorTail = buf.toString('utf-8');
    }
  } catch {}

  return {
    label,
    installed: true,
    pid,
    last_exit: lastExit,
    running: pid != null && pid > 0,
    error_log: errLog,
    error_size: errorSize,
    error_mtime: errorMtime,
    error_tail: errorTail.slice(-4096),
  };
}

async function getState() {
  const items = await Promise.all(LABELS.map(inspectLabel));
  // Restart heuristic: look for ThrottleInterval respawn lines in stdout log,
  // or fallback by counting timestamps in error log.
  for (const item of items) {
    if (!item.installed || !item.error_tail) continue;
    const restarts = item.error_tail.split('\n').filter(
      (ln) => /respawn|exited with code|signal|crash|Traceback/i.test(ln),
    ).length;
    item.restart_hits_in_tail = restarts;
  }
  return { services: items };
}

async function writeReport() {
  const state = await getState();
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const now = new Date();
  const fname = `crash-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
  const target = path.join(REPORTS_DIR, fname);
  const lines = [
    `XJarvis Crash Report — ${now.toISOString()}`,
    '='.repeat(60),
    `Host: ${os.hostname()} · ${os.type()} ${os.release()}`,
    `Uptime: ${Math.round(os.uptime() / 60)}min · Load: ${os.loadavg().map((n) => n.toFixed(2)).join(' ')}`,
    `Free mem: ${(os.freemem() / 1024 / 1024).toFixed(0)}MB / ${(os.totalmem() / 1024 / 1024).toFixed(0)}MB`,
    '',
    '## Services',
  ];
  for (const s of state.services) {
    lines.push('');
    lines.push(`### ${s.label}`);
    if (!s.installed) { lines.push('  not installed'); continue; }
    lines.push(`  pid: ${s.pid ?? '—'}    last_exit: ${s.last_exit ?? '—'}    running: ${s.running}`);
    lines.push(`  error_log: ${s.error_log}  size=${s.error_size}  mtime=${s.error_mtime ? new Date(s.error_mtime).toISOString() : '—'}`);
    lines.push(`  hits in tail: ${s.restart_hits_in_tail || 0}`);
    if (s.error_tail) {
      lines.push('  --- error tail ---');
      for (const ln of s.error_tail.split('\n').slice(-40)) lines.push(`    ${ln}`);
    }
  }
  fs.writeFileSync(target, lines.join('\n') + '\n');
  return { ok: true, path: target, bytes: lines.join('\n').length };
}

async function handleHttp(req, res) {
  if (req.url === '/api/crash/state' && req.method === 'GET') {
    const data = await getState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }
  if (req.url === '/api/crash/report' && req.method === 'POST') {
    const r = await writeReport();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r));
    return;
  }
  return null;
}

function shouldHandle(url) {
  return url.startsWith('/api/crash/');
}

module.exports = { handleHttp, shouldHandle };
