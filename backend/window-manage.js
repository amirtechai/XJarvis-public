/**
 * Window management — yabai veya AppleScript System Events ile pencere düzeni.
 *
 * yabai mevcutsa onu tercih eder (daha güçlü). Yoksa System Events ile
 * AppleScript-tabanlı set bounds yöntemi.
 *
 *   POST /api/windows/layout {layout: "split-2|split-3|focus|side-by-side", apps: [...]}
 *   POST /api/windows/focus {app}
 *   POST /api/windows/raw {script}        — admin tarafından AppleScript çalıştır
 *   GET  /api/windows/state               — mevcut pencereler
 */
const { exec } = require('child_process');

function osa(script, ms = 8000) {
  return new Promise((resolve) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: ms }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || stderr || '').trim() });
    });
  });
}

function shell(cmd, ms = 5000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: ms }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || stderr || '').trim() });
    });
  });
}

async function hasYabai() {
  const r = await shell('command -v yabai', 2000);
  return r.ok && r.output.length > 0;
}

async function focusApp(app) {
  const safeName = String(app || '').replace(/"/g, '');
  return osa(`tell application "${safeName}" to activate`, 5000);
}

async function getScreenBounds() {
  const r = await osa(`
    tell application "Finder" to get bounds of window of desktop
  `, 4000);
  // Returns "0, 0, W, H"
  const m = r.output.match(/(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)/);
  if (!m) return { x: 0, y: 0, w: 1920, h: 1080 };
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) - Number(m[1]), h: Number(m[4]) - Number(m[2]) };
}

async function setWindowBounds(app, bounds) {
  const safe = String(app || '').replace(/"/g, '');
  const { x, y, w, h } = bounds;
  const script = `
    tell application "System Events" to tell process "${safe}"
      try
        set position of window 1 to {${x}, ${y}}
        set size of window 1 to {${w}, ${h}}
      end try
    end tell
  `;
  return osa(script, 6000);
}

async function applyLayoutNative(layout, apps) {
  const screen = await getScreenBounds();
  const M = 8; // margin between windows
  const W = screen.w - M * (apps.length + 1);
  const H = screen.h - M * 2;

  // Bring each app to front first
  for (const a of apps) await focusApp(a);

  if (layout === 'focus' && apps.length >= 1) {
    await setWindowBounds(apps[0], { x: screen.x + M, y: screen.y + M, w: screen.w - 2 * M, h: H });
    return { ok: true, layout, apps };
  }

  if (layout === 'split-2' && apps.length >= 2) {
    const each = Math.floor(W / 2);
    await setWindowBounds(apps[0], { x: screen.x + M, y: screen.y + M, w: each, h: H });
    await setWindowBounds(apps[1], { x: screen.x + M + each + M, y: screen.y + M, w: each, h: H });
    return { ok: true, layout, apps };
  }

  if (layout === 'split-3' && apps.length >= 3) {
    const each = Math.floor(W / 3);
    let x = screen.x + M;
    for (let i = 0; i < 3; i++) {
      await setWindowBounds(apps[i], { x, y: screen.y + M, w: each, h: H });
      x += each + M;
    }
    return { ok: true, layout, apps };
  }

  if (layout === 'side-by-side' && apps.length >= 2) {
    const each = Math.floor(W / apps.length);
    let x = screen.x + M;
    for (const a of apps) {
      await setWindowBounds(a, { x, y: screen.y + M, w: each, h: H });
      x += each + M;
    }
    return { ok: true, layout, apps };
  }

  return { ok: false, error: `unknown layout '${layout}' or not enough apps` };
}

async function applyLayout(layout, apps) {
  if (await hasYabai()) {
    // yabai is more reliable; we simulate equivalent layouts via space focus + window focus.
    // For simplicity we still use AppleScript fallback even on yabai systems —
    // proper yabai integration would require a dedicated config. Future work.
  }
  return applyLayoutNative(layout, apps);
}

async function listWindows() {
  const script = `
    set out to ""
    tell application "System Events"
      repeat with p in (application processes whose visible is true)
        try
          set wins to (windows of p)
          repeat with w in wins
            set out to out & (name of p) & "|||" & (name of w) & linefeed
          end repeat
        end try
      end repeat
    end tell
    return out
  `;
  const r = await osa(script, 8000);
  return r.output.split('\n').filter(Boolean).map((l) => {
    const [app, win] = l.split('|||');
    return { app: (app || '').trim(), title: (win || '').trim() };
  });
}

function shouldHandle(url) { return url.startsWith('/api/windows'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'GET' && req.url === '/api/windows/state') {
      const wins = await listWindows();
      res.writeHead(200); res.end(JSON.stringify(wins)); return;
    }
    if (req.method === 'POST' && req.url === '/api/windows/focus') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await focusApp(body.app);
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && req.url === '/api/windows/layout') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await applyLayout(body.layout, body.apps || []);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { applyLayout, focusApp, listWindows, shouldHandle, handleHttp };
