/**
 * macOS permission probe — best-effort status report for Microphone,
 * Camera, Accessibility, and Full Disk Access.
 *
 *   GET /api/permissions/state
 *
 * Note: macOS doesn't expose a clean "is X authorised?" API, so we use a
 * pragmatic mix: check tcc.db readability, query process status, run a
 * one-shot probe via osascript / sqlite3. Results are advisory.
 */
const { exec } = require('child_process');

function run(cmd, timeoutMs = 1500) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
      });
    });
  });
}

/**
 * macOS TCC DB lives at ~/Library/Application Support/com.apple.TCC/TCC.db
 * If we can read it (Full Disk Access granted to our parent terminal),
 * we can directly query authorisation rows.  Otherwise we fall back to
 * heuristic probes.
 */
async function readTccUser() {
  const home = process.env.HOME;
  const db = `${home}/Library/Application Support/com.apple.TCC/TCC.db`;
  // Auth value 2 = allowed (modern), 0 = denied, 1 = unknown/legacy
  const r = await run(
    `sqlite3 "${db}" "SELECT service, client, auth_value FROM access" 2>/dev/null`,
    2000,
  );
  if (!r.ok || !r.stdout) return null;
  const rows = r.stdout.split('\n').map((l) => l.split('|'));
  const out = {};
  for (const [service, client, auth] of rows) {
    if (!out[service]) out[service] = [];
    out[service].push({ client, allowed: auth === '2' });
  }
  return out;
}

async function micStatus(tcc) {
  if (tcc?.['kTCCServiceMicrophone']) {
    const granted = tcc['kTCCServiceMicrophone'].some((r) => r.allowed);
    return { state: granted ? 'granted' : 'denied', source: 'tcc' };
  }
  // Fallback: assume unknown
  return { state: 'unknown', source: 'fallback' };
}

async function cameraStatus(tcc) {
  if (tcc?.['kTCCServiceCamera']) {
    const granted = tcc['kTCCServiceCamera'].some((r) => r.allowed);
    return { state: granted ? 'granted' : 'denied', source: 'tcc' };
  }
  return { state: 'unknown', source: 'fallback' };
}

async function accessibilityStatus(tcc) {
  if (tcc?.['kTCCServiceAccessibility']) {
    const granted = tcc['kTCCServiceAccessibility'].some((r) => r.allowed);
    return { state: granted ? 'granted' : 'denied', source: 'tcc' };
  }
  // Fallback: try a benign osascript that only succeeds with Accessibility
  const r = await run(
    `osascript -e 'tell application "System Events" to count processes' 2>/dev/null`,
    1000,
  );
  return r.ok ? { state: 'granted', source: 'osascript' } : { state: 'denied', source: 'osascript' };
}

async function fullDiskStatus() {
  // Reading the TCC.db directly is itself the litmus test
  const home = process.env.HOME;
  const r = await run(
    `head -c 100 "${home}/Library/Application Support/com.apple.TCC/TCC.db" 2>/dev/null | wc -c`,
    1000,
  );
  const bytes = parseInt(r.stdout, 10);
  if (Number.isFinite(bytes) && bytes > 0) {
    return { state: 'granted', source: 'tcc-read' };
  }
  return { state: 'unknown', source: 'fallback' };
}

const SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_';

async function stateHandler(req, res) {
  const tcc = await readTccUser();
  const [mic, camera, accessibility, fullDisk] = await Promise.all([
    micStatus(tcc),
    cameraStatus(tcc),
    accessibilityStatus(tcc),
    fullDiskStatus(),
  ]);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    mic, camera, accessibility, fullDisk,
    settings_url: {
      mic:           `${SETTINGS_URL}Microphone`,
      camera:        `${SETTINGS_URL}Camera`,
      accessibility: `${SETTINGS_URL}Accessibility`,
      fullDisk:      `${SETTINGS_URL}AllFiles`,
    },
  }));
}

async function openHandler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const which = url.searchParams.get('which');
  const map = {
    mic:           `${SETTINGS_URL}Microphone`,
    camera:        `${SETTINGS_URL}Camera`,
    accessibility: `${SETTINGS_URL}Accessibility`,
    fulldisk:      `${SETTINGS_URL}AllFiles`,
  };
  const target = map[which];
  if (!target) { res.writeHead(400); res.end(); return; }
  exec(`open "${target}"`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

function handleHttp(req, res) {
  if (!req.url.startsWith('/api/permissions')) return null;
  if (req.method === 'GET' && req.url === '/api/permissions/state') return stateHandler(req, res);
  if (req.method === 'POST' && req.url.startsWith('/api/permissions/open')) return openHandler(req, res);
  res.writeHead(404);
  res.end();
  return undefined;
}

module.exports = { handleHttp };
