/**
 * Multi-monitor / window arrangement helper.
 *
 *   GET  /api/monitors/state       → bağlı ekran sayısı + aktif düzen
 *   POST /api/monitors/arrange     {count: 1|2|3|4|-1}  → AppleScript ile pencere düzeni
 *
 * count = 1  : focused app full-screen on main display
 * count = 2  : 50/50 horizontal split (front 2 apps)
 * count = 3  : main left + 2 stacked right
 * count = 4  : 2x2 grid
 * count = -1 : every connected display gets one app (broadcast)
 */
const { execFile } = require('child_process');

let activeMode = 1;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function osascript(script) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message });
      resolve({ ok: true, out: stdout.trim() });
    });
  });
}

async function getDisplayCount() {
  const r = await osascript(`tell application "System Events" to count of (every desktop)`);
  if (!r.ok) return 1;
  return Math.max(1, parseInt(r.out, 10) || 1);
}

const ARRANGE_SCRIPTS = {
  1: `
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      tell frontApp
        try
          tell window 1 to set value of attribute "AXFullScreen" to true
        end try
      end tell
    end tell`,
  2: `
    tell application "Finder" to set screenBounds to bounds of window of desktop
    set sw to item 3 of screenBounds
    set sh to item 4 of screenBounds
    tell application "System Events"
      set procs to (every application process whose visible is true and background only is false)
      set targets to {}
      repeat with p in procs
        try
          if (count of windows of p) > 0 then set end of targets to p
        end try
      end repeat
      if (count of targets) ≥ 1 then
        tell window 1 of (item 1 of targets) to set position to {0, 22}
        tell window 1 of (item 1 of targets) to set size to {sw / 2, sh - 22}
      end if
      if (count of targets) ≥ 2 then
        tell window 1 of (item 2 of targets) to set position to {sw / 2, 22}
        tell window 1 of (item 2 of targets) to set size to {sw / 2, sh - 22}
      end if
    end tell`,
  3: `
    tell application "Finder" to set screenBounds to bounds of window of desktop
    set sw to item 3 of screenBounds
    set sh to item 4 of screenBounds
    tell application "System Events"
      set procs to (every application process whose visible is true and background only is false)
      set targets to {}
      repeat with p in procs
        try
          if (count of windows of p) > 0 then set end of targets to p
        end try
      end repeat
      if (count of targets) ≥ 1 then
        tell window 1 of (item 1 of targets) to set position to {0, 22}
        tell window 1 of (item 1 of targets) to set size to {sw / 2, sh - 22}
      end if
      if (count of targets) ≥ 2 then
        tell window 1 of (item 2 of targets) to set position to {sw / 2, 22}
        tell window 1 of (item 2 of targets) to set size to {sw / 2, (sh - 22) / 2}
      end if
      if (count of targets) ≥ 3 then
        tell window 1 of (item 3 of targets) to set position to {sw / 2, 22 + (sh - 22) / 2}
        tell window 1 of (item 3 of targets) to set size to {sw / 2, (sh - 22) / 2}
      end if
    end tell`,
  4: `
    tell application "Finder" to set screenBounds to bounds of window of desktop
    set sw to item 3 of screenBounds
    set sh to item 4 of screenBounds
    set hw to sw / 2
    set hh to (sh - 22) / 2
    tell application "System Events"
      set procs to (every application process whose visible is true and background only is false)
      set targets to {}
      repeat with p in procs
        try
          if (count of windows of p) > 0 then set end of targets to p
        end try
      end repeat
      if (count of targets) ≥ 1 then
        tell window 1 of (item 1 of targets) to set position to {0, 22}
        tell window 1 of (item 1 of targets) to set size to {hw, hh}
      end if
      if (count of targets) ≥ 2 then
        tell window 1 of (item 2 of targets) to set position to {hw, 22}
        tell window 1 of (item 2 of targets) to set size to {hw, hh}
      end if
      if (count of targets) ≥ 3 then
        tell window 1 of (item 3 of targets) to set position to {0, 22 + hh}
        tell window 1 of (item 3 of targets) to set size to {hw, hh}
      end if
      if (count of targets) ≥ 4 then
        tell window 1 of (item 4 of targets) to set position to {hw, 22 + hh}
        tell window 1 of (item 4 of targets) to set size to {hw, hh}
      end if
    end tell`,
};

async function arrange(count) {
  if (count === -1) {
    // broadcast — for now, fallback to count=4 if 4 displays exist, else use display count
    const dc = await getDisplayCount();
    const target = Math.max(1, Math.min(4, dc));
    return arrange(target);
  }
  const c = parseInt(count, 10);
  const script = ARRANGE_SCRIPTS[c];
  if (!script) return { ok: false, error: 'unsupported count' };
  const r = await osascript(script);
  if (r.ok) activeMode = c;
  return r;
}

function shouldHandle(url) { return url.startsWith('/api/monitors/'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/monitors/state') {
      const count = await getDisplayCount();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, count, active: activeMode }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/monitors/arrange') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await arrange(body.count);
      res.writeHead(r.ok ? 200 : 400);
      res.end(JSON.stringify({ ...r, active: activeMode }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle, arrange, getDisplayCount };
