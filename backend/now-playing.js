/**
 * Now Playing — querys macOS Music + Spotify via AppleScript, returns whichever
 * is currently playing (or last touched).
 *
 *   GET  /api/now-playing                  → { player, title, artist, state }
 *   POST /api/now-playing/control          → { action: play|pause|next|prev }
 */
const { exec } = require('child_process');

function osa(script, timeoutMs = 2000) {
  return new Promise((resolve) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? '' : (stdout || '').trim());
    });
  });
}

async function isRunning(app) {
  // ÖNEMLİ: `tell application "X"` Music.app'i lazy-launch eder.
  // System Events üzerinden process listesi kontrolü app'i tetiklemez.
  const out = await osa(`tell application "System Events" to (name of processes) contains "${app}"`);
  return out === 'true';
}

async function readPlayer(app) {
  // App çalışmıyorsa AppleScript'i ÇAĞIRMA — yoksa lazy-launch tetikler.
  if (!(await isRunning(app))) return null;
  const script = `
    tell application "${app}"
      try
        set s to player state as text
        set t to name of current track
        set ar to artist of current track
        return s & "|||" & t & "|||" & ar
      end try
      return ""
    end tell
  `;
  const out = await osa(script);
  if (!out) return null;
  const [state, title, artist] = out.split('|||');
  if (!title) return null;
  return {
    player: app,
    state: state.toLowerCase().includes('play') ? 'playing'
         : state.toLowerCase().includes('pause') ? 'paused' : 'stopped',
    title, artist,
  };
}

async function nowHandler(req, res) {
  const [music, spotify] = await Promise.all([readPlayer('Music'), readPlayer('Spotify')]);
  const winner =
    (spotify && spotify.state === 'playing') ? spotify :
    (music && music.state === 'playing') ? music :
    spotify || music;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(winner || {}));
}

async function controlHandler(req, res) {
  const cs = []; req.on('data', (c) => cs.push(c));
  req.on('end', async () => {
    let body = {}; try { body = JSON.parse(Buffer.concat(cs).toString() || '{}'); } catch {}
    const action = body.action;
    const map = { play: 'play', pause: 'pause', next: 'next track', prev: 'previous track' };
    const cmd = map[action];
    if (!cmd) { res.writeHead(400); res.end('{"ok":false}'); return; }
    // pick whichever player has a current track
    const [music, spotify] = await Promise.all([readPlayer('Music'), readPlayer('Spotify')]);
    // Hiçbiri çalışmıyorsa hiçbir uygulamayı LANZE ETME — sessizce dön.
    const target = (spotify && spotify.state !== 'stopped') ? 'Spotify'
                 : (music && music.state !== 'stopped') ? 'Music'
                 : null;
    if (!target) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'no active media player' }));
      return;
    }
    await osa(`tell application "${target}" to ${cmd}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, target, action }));
  });
}

async function handleHttp(req, res) {
  if (req.url === '/api/now-playing' && req.method === 'GET') return nowHandler(req, res);
  if (req.url === '/api/now-playing/control' && req.method === 'POST') return controlHandler(req, res);
  return null;
}

function shouldHandle(url) { return url.startsWith('/api/now-playing'); }

module.exports = { handleHttp, shouldHandle };
