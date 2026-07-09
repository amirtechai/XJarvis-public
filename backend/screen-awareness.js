/**
 * Screen awareness (opt-in) — periyodik screencapture → vision LLM → context cache.
 *
 * Default kapalı. Açık olduğunda her N dakikada bir ana ekranın küçük bir
 * görüntüsünü alır, LLM'e "ne görüyorsun? 1-2 cümle özetle" diye sorar ve
 * sonucu ~/.config/xjarvis/screen-context.json'a yazar. Heartbeat ve
 * agent bu dosyayı okur.
 *
 * Privacy:
 *   • Lokal screencapture; image LLM'e base64 olarak gönderiliyor (cloud)
 *   • Görüntü diske kaydedilmiyor — RAM'de işlenip atılıyor
 *   • Hassas içerik yakalama riski sebebiyle DEFAULT KAPALI
 *
 * Config: ~/.config/xjarvis/screen-awareness.json
 *   { enabled, interval_min: 5, model: "google/gemini-2.5-flash-lite" }
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'screen-awareness.json');
const CONTEXT_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'screen-context.json');

let config = { enabled: false, interval_min: 5, model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' };
let timer = null;

function loadConfig() {
  try { if (fs.existsSync(CONFIG_PATH)) Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))); } catch {}
}
function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
function writeContext(entry) {
  fs.mkdirSync(path.dirname(CONTEXT_PATH), { recursive: true });
  fs.writeFileSync(CONTEXT_PATH, JSON.stringify(entry, null, 2));
}
function readContext() {
  try { return JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf-8')); } catch { return null; }
}

function captureScreen() {
  return new Promise((resolve) => {
    const tmp = `/tmp/xjarvis-screen-${Date.now()}.jpg`;
    // -x silent, -t jpg, -T0 no delay; whole main display
    execFile('screencapture', ['-x', '-t', 'jpg', '-T0', tmp], (err) => {
      if (err) return resolve(null);
      try {
        const buf = fs.readFileSync(tmp);
        fs.unlinkSync(tmp);                     // never persist the raw shot
        resolve(buf.toString('base64'));
      } catch { resolve(null); }
    });
  });
}

// Tek vision yolu: Python agent :8767 /vision/describe → Anthropic Agent SDK
// (abonelik kredisi). OpenRouter/Together YOK.
function callVisionLLM(b64) {
  const query = 'Bu ekran görüntüsüne bak, kullanıcının ne yaptığına dair 1-2 cümlelik Türkçe özet ver. Sadece açıkça görünen şeyi yaz, spekülasyon yapma. Hassas içerik (parola, banka, özel mesaj) varsa "hassas içerik görüldü" de, detay verme.';
  const body = JSON.stringify({ image_b64: b64, query });
  const port = process.env.AGENT_PORT || 8767;
  return new Promise((resolve) => {
    const req = http.request({
      method: 'POST', host: '127.0.0.1', port, path: '/vision/describe',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 45000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          resolve(j.ok ? (j.text || null) : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.write(body); req.end();
  });
}

async function tick({ force = false } = {}) {
  if (!force && !config.enabled) return { skipped: 'disabled' };
  const b64 = await captureScreen();
  if (!b64) return { skipped: 'capture_failed' };
  const summary = await callVisionLLM(b64);
  if (!summary) return { skipped: 'llm_failed' };
  const entry = { ts: Date.now(), summary: summary.trim() };
  writeContext(entry);
  console.log('[screen] context updated');
  return { ok: true, ...entry };
}

function start() {
  loadConfig();
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick().catch(() => {}), Math.max(60_000, config.interval_min * 60_000));
  console.log(`[screen] watcher started (every ${config.interval_min}m, enabled=${config.enabled})`);
}

function getConfig() { return { ...config, last_context: readContext() }; }
function setConfig(patch) {
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
  if (typeof patch.interval_min === 'number' && patch.interval_min >= 1) config.interval_min = patch.interval_min;
  if (typeof patch.model === 'string') config.model = patch.model;
  saveConfig(); start();
  return getConfig();
}

function shouldHandle(url) { return url.startsWith('/api/screen-awareness'); }
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/api/screen-awareness/config') {
    res.writeHead(200); res.end(JSON.stringify(getConfig())); return;
  }
  if (req.method === 'POST' && req.url === '/api/screen-awareness/config') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { res.writeHead(200); res.end(JSON.stringify(setConfig(JSON.parse(body || '{}')))); }
      catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/screen-awareness/snap') {
    const r = await tick({ force: true });
    res.writeHead(200); res.end(JSON.stringify(r)); return;
  }
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { start, tick, getConfig, setConfig, shouldHandle, handleHttp };
