/**
 * Desktop app control — sesli komutla macOS uygulamalarını kontrol et.
 *
 * Endpointler:
 *   YouTube:
 *     POST /api/app/youtube       {action: "search|play|pause|next|prev|volume_up|volume_down|mute|fullscreen|save_to_playlist", query?, playlist?}
 *
 *   Desktop AI (ChatGPT / Claude / Gemini / Kimi / Qwen):
 *     POST /api/app/ai           {app, prompt}
 *
 *   Apple Notes (add/find — ASLA delete):
 *     POST /api/app/notes/add    {title, body}
 *     GET  /api/app/notes/find?q=...
 *
 * macOS Privacy → Automation izni gerek (Notes, Safari/Chrome, ChatGPT vb.).
 */
const { exec, spawn } = require('child_process');

function osa(script, ms = 8000) {
  return new Promise((resolve) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: ms, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
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

// ---------------------------------------------------------------------------
// YouTube control — open YouTube in default browser, send media keys / JS.
// macOS provides system-wide media keys via osascript (System Events 16/27/28
// are play, prev, next). For volume up/down on a YouTube tab we use AppleScript
// keystrokes after focusing the YouTube tab.
// ---------------------------------------------------------------------------

const MEDIA_KEYS = {
  play_pause: 16,   // F8 / play
  next: 17,         // F9
  prev: 18,         // F7
};

async function focusYouTube() {
  // Try Chrome first, then Safari, then default browser.
  const browsers = ['Google Chrome', 'Arc', 'Safari'];
  for (const b of browsers) {
    const r = await osa(`
      tell application "${b}"
        if (count of windows) > 0 then
          repeat with w in windows
            repeat with t in tabs of w
              try
                if (URL of t) contains "youtube.com" then
                  set active tab index of w to (index of t)
                  set index of w to 1
                  activate
                  return "ok"
                end if
              end try
            end repeat
          end repeat
        end if
      end tell
      return "no"
    `, 6000);
    if (r.ok && r.output === 'ok') return { ok: true, browser: b };
  }
  return { ok: false, error: 'YouTube tab not found' };
}

async function youtubeSearch(query) {
  if (!query) return { ok: false, error: 'query required' };
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return osa(`tell application "Google Chrome" to (open location "${url}")
on error
  tell application "Safari" to open location "${url}"
end try`, 6000);
}

async function youtubeFirstResultPlay(query) {
  // Open search → wait → run JS to click first video. Chrome only via tab evaluation.
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  await osa(`tell application "Google Chrome" to (open location "${url}")`, 6000);
  // Brief wait then click the first thumbnail
  await new Promise((r) => setTimeout(r, 2500));
  return osa(`
    tell application "Google Chrome"
      set jsCode to "var v = document.querySelector('a#thumbnail[href*=watch]'); if (v) { v.click(); 'ok' } else { 'no' }"
      execute front window's active tab javascript jsCode
    end tell
  `, 6000);
}

async function pressMediaKey(keyCode) {
  // macOS system-wide media key via NSEvent — use AppleScript with key code via System Events
  return osa(`
    tell application "System Events"
      key code ${keyCode}
    end tell
  `, 4000);
}

async function youtubeAction(action, params = {}) {
  switch (action) {
    case 'search':
      return youtubeSearch(params.query);
    case 'play':
    case 'pause':
    case 'play_pause':
      // First ensure YT focused, then press play/pause
      await focusYouTube();
      // YouTube uses K shortcut for play/pause
      return osa(`tell application "System Events" to keystroke "k"`, 4000);
    case 'next':
      await focusYouTube();
      return osa(`tell application "System Events" to keystroke "n" using shift down`, 4000);
    case 'prev':
      await focusYouTube();
      return osa(`tell application "System Events" to keystroke "p" using shift down`, 4000);
    case 'volume_up':
      // Tab must be focused. YT uses arrow up.
      await focusYouTube();
      return osa(`tell application "System Events" to key code 126`, 4000); // up arrow
    case 'volume_down':
      await focusYouTube();
      return osa(`tell application "System Events" to key code 125`, 4000);
    case 'mute':
      await focusYouTube();
      return osa(`tell application "System Events" to keystroke "m"`, 4000);
    case 'fullscreen':
      await focusYouTube();
      return osa(`tell application "System Events" to keystroke "f"`, 4000);
    case 'first_result_play':
      return youtubeFirstResultPlay(params.query);
    case 'save_to_playlist': {
      // Click "Save" button next to video, then click target playlist label.
      // Best-effort JS via Chrome.
      await focusYouTube();
      const pl = String(params.playlist || '').replace(/"/g, '\\"');
      const js = `(function(){var s=document.querySelector('button[aria-label="Save to playlist"], button[aria-label="Kaydet"]');if(!s)return'no_save_btn';s.click();setTimeout(function(){var labels=document.querySelectorAll('yt-formatted-string');for(var i=0;i<labels.length;i++){if(labels[i].textContent.trim()==="${pl}"){labels[i].click();return;}}},700);return'ok';})()`;
      return osa(`tell application "Google Chrome" to execute front window's active tab javascript "${js.replace(/"/g, '\\"')}"`, 6000);
    }
    default:
      return { ok: false, error: `unknown action ${action}` };
  }
}

// ---------------------------------------------------------------------------
// Desktop AI app prompt sender.
// ---------------------------------------------------------------------------
const AI_APPS = {
  chatgpt: { name: 'ChatGPT', activate: 'ChatGPT' },
  claude: { name: 'Claude', activate: 'Claude' },
  gemini: { name: 'Google Gemini', activate: 'Google Gemini' },
  kimi: { name: 'Kimi', activate: 'Kimi' },
  qwen: { name: 'Qwen', activate: 'Qwen' },
};

async function sendToAIApp(appKey, prompt) {
  const cfg = AI_APPS[appKey?.toLowerCase()];
  if (!cfg) return { ok: false, error: `unknown app ${appKey}` };
  if (!prompt || !prompt.trim()) return { ok: false, error: 'prompt required' };

  // Activate app
  await osa(`tell application "${cfg.activate}" to activate`, 5000);
  // Wait for focus
  await new Promise((r) => setTimeout(r, 700));
  // Open new chat (Cmd+N)
  await osa(`tell application "System Events" to keystroke "n" using command down`, 3000);
  await new Promise((r) => setTimeout(r, 500));
  // Set clipboard, paste, then send
  const escaped = prompt.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
  // Use pbcopy for clean unicode handling
  await new Promise((res) => {
    const p = spawn('pbcopy'); p.stdin.write(prompt); p.stdin.end(); p.on('close', res);
  });
  await osa(`tell application "System Events" to keystroke "v" using command down`, 3000);
  await new Promise((r) => setTimeout(r, 300));
  await osa(`tell application "System Events" to key code 36`, 3000); // return key
  return { ok: true, app: cfg.name, sent: prompt.length };
}

// ---------------------------------------------------------------------------
// Apple Notes — add + find (NO delete).
// ---------------------------------------------------------------------------
async function notesAdd({ title, body, folder = '' }) {
  if (!title) return { ok: false, error: 'title required' };
  const safeTitle = String(title).replace(/"/g, '\\"');
  const safeBody = String(body || '').replace(/"/g, '\\"').replace(/\n/g, '<br>');
  let target = `make new note with properties {name:"${safeTitle}", body:"<h3>${safeTitle}</h3><p>${safeBody}</p>"}`;
  let scriptBody;
  if (folder) {
    const safeFolder = folder.replace(/"/g, '\\"');
    scriptBody = `
      tell application "Notes"
        tell account "iCloud"
          if (folders whose name is "${safeFolder}") = {} then
            make new folder with properties {name:"${safeFolder}"}
          end if
          tell folder "${safeFolder}"
            ${target}
          end tell
        end tell
      end tell`;
  } else {
    scriptBody = `tell application "Notes" to tell account "iCloud" to ${target}`;
  }
  return osa(scriptBody, 10_000);
}

async function notesFind(query) {
  const safe = String(query || '').replace(/"/g, '\\"');
  // Empty query → list son 25 not (modification date'e göre AppleScript sıralaması yok, capped)
  const filter = safe
    ? `set matches to (notes whose (name contains "${safe}") or (body contains "${safe}"))`
    : `set matches to notes`;
  const script = `
    set out to ""
    tell application "Notes"
      tell account "iCloud"
        ${filter}
        repeat with m in matches
          try
            set out to out & (name of m) & "|||" & (modification date of m as string) & linefeed
          end try
        end repeat
      end tell
    end tell
    return out
  `;
  const r = await osa(script, 12_000);
  if (!r.ok) return r;
  const matches = r.output.split('\n').filter(Boolean).map((l) => {
    const [title, modified] = l.split('|||');
    return { title: (title || '').trim(), modified: (modified || '').trim() };
  }).slice(0, 25);
  return { ok: true, count: matches.length, matches };
}

// ---------------------------------------------------------------------------
// HTTP wiring
// ---------------------------------------------------------------------------
function shouldHandle(url) { return url.startsWith('/api/app/'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/api/app/open-url') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const u = String(body.url || '').trim();
      if (!/^https?:\/\//.test(u)) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'bad url' })); return; }
      // Tek argüman olarak shell'e geçir; bash kötü kaçışı önlemek için spawn kullan
      const { spawn } = require('child_process');
      const child = spawn('open', [u], { detached: true, stdio: 'ignore' });
      child.unref();
      res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
    }

    if (req.method === 'POST' && url.pathname === '/api/app/youtube') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await youtubeAction(body.action, body);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }

    if (req.method === 'POST' && url.pathname === '/api/app/ai') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await sendToAIApp(body.app, body.prompt);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }

    if (req.method === 'POST' && url.pathname === '/api/app/notes/add') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await notesAdd(body);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/app/notes/find') {
      const r = await notesFind(url.searchParams.get('q'));
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { youtubeAction, sendToAIApp, notesAdd, notesFind, shouldHandle, handleHttp };
