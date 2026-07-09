/**
 * Mac-side bridge to xjarvis.your-domain.example.
 *
 * Periodically polls the remote command queue. Each fetched command is
 * injected as a synthetic `voice_input` so it flows through the normal
 * router → agent → response path. The final reply text is shipped back
 * to the server with the originating cmd_id, which lets the server send
 * the answer to whichever channel produced the command (Telegram, web).
 */
const http = require('http');
const https = require('https');
const { bus, EVENT_TYPES } = require('./events/bus');

const SERVER_URL = (process.env.XJARVIS_SERVER_URL || '').replace(/\/$/, '');
const TOKEN = process.env.XJARVIS_SHARED_TOKEN || '';
const POLL_MS = parseInt(process.env.XJARVIS_BRIDGE_POLL_MS || '4000', 10);

let lastResponseBuffer = '';
let activeCmdId = null;
let runningPoll = false;
// BULGU 5 fix: RESPONSE_START/CHUNK/END envelope'u remote/local ayrımı
// taşımıyor (router.js her zaman source:'system' ile emit ediyor; QUERY_
// RECEIVED'daki channel/source alanları da gerçek bridge yolunda (runOneCommand
// → routeMessage) 'remote' olarak işaretlenmiyor — injectCommand() bunu
// yapıyor ama kullanılmıyor/dead-code). Yani envelope'tan güvenilir bir
// remote/local ayrımı YOK. Minimal-güvenli çözüm: bridge kendi komutunu
// enjekte ettiğinde SENKRON (ilk await'ten önce) tetiklenen QUERY_RECEIVED'ı
// "kendi sorgumuz" say (awaitingOwnQuery), ondan SONRA activeCmdId hâlâ set
// iken gelen herhangi bir QUERY_RECEIVED = kullanıcı Mac'te aynı anda lokal
// konuştu/yazdı demektir → belirsizlikte SIZDIRMAMAK için capture'ı iptal et
// (o turda Telegram'a cevap gitmez, ama lokal cevap uzağa asla sızmaz).
let awaitingOwnQuery = false;

function httpJson(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : '';
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-XJarvis-Token': TOKEN,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: 15_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        try { resolve({ status: res.statusCode, json: JSON.parse(text || '{}') }); }
        catch { resolve({ status: res.statusCode, json: null, raw: text }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('bridge timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function reportReply(cmdId, text) {
  if (!cmdId || !text) return;
  try {
    await httpJson('POST', `${SERVER_URL}/api/command-queue/reply`, {
      cmd_id: cmdId, text, source: 'mac',
    });
  } catch (e) { console.warn('[bridge] reply post failed:', e.message); }
}

function attachReplyCapture() {
  bus.on(EVENT_TYPES.QUERY_RECEIVED, () => {
    if (awaitingOwnQuery) {
      // Bu bizim az önce enjekte ettiğimiz komutun kendi yankısı — normal.
      awaitingOwnQuery = false;
      return;
    }
    if (activeCmdId) {
      // Bridge komutu hâlâ aktifken ARAYA başka bir sorgu girdi (lokal
      // kullanıcı aynı anda konuştu/yazdı). Hangi RESPONSE_* olayının kime
      // ait olduğunu ayırt edemeyiz → capture'ı iptal et, sızdırma.
      console.warn('[bridge] local query interleaved with active remote command — aborting reply capture to avoid leak');
      activeCmdId = null;
      lastResponseBuffer = '';
    }
  });
  bus.on(EVENT_TYPES.RESPONSE_START, () => {
    lastResponseBuffer = '';
  });
  bus.on(EVENT_TYPES.RESPONSE_CHUNK, (envelope) => {
    if (!activeCmdId) return; // sadece aktif bridge komutu penceresinde buffer'la
    const t = envelope?.payload?.text;
    if (typeof t === 'string') lastResponseBuffer += t;
  });
  bus.on(EVENT_TYPES.RESPONSE_END, () => {
    if (activeCmdId && lastResponseBuffer.trim()) {
      reportReply(activeCmdId, lastResponseBuffer.trim());
    }
    activeCmdId = null;
    lastResponseBuffer = '';
  });
}

// (injectCommand kaldırıldı — dead code'du; gerçek yol runOneCommand→routeMessage.)

async function pollOnce() {
  if (!SERVER_URL || !TOKEN) return;
  if (runningPoll) return;
  runningPoll = true;
  try {
    const { json } = await httpJson('GET', `${SERVER_URL}/api/command-queue/poll`);
    const items = json?.items || [];
    if (items.length) console.log(`[bridge] picked up ${items.length} remote command(s)`);
    for (const cmd of items) {
      // Run sequentially so the reply-capture for each command is clean.
      activeCmdId = cmd.id;
      await runOneCommand(cmd);
    }
  } catch (e) {
    if (!/ENOTFOUND|ECONNREFUSED|timeout/.test(e.message))
      console.warn('[bridge] poll error:', e.message);
  } finally {
    runningPoll = false;
  }
}

// Run a command through the real router so all tools / persona / memory apply.
async function runOneCommand(cmd) {
  return new Promise((resolve) => {
    const handler = (env) => {
      if (env?.source === 'system') { /* downstream */ }
    };
    // Mark this command id as the active reply target before injecting.
    activeCmdId = cmd.id;
    lastResponseBuffer = '';
    awaitingOwnQuery = true; // routeMessage'ın senkron QUERY_RECEIVED'ı gelene kadar
    // Forward to the WS router by emitting a synthetic message on the bus.
    // router.js listens for `chat_message`/`voice_input` on the WS layer,
    // not bus, so we call routeMessage directly via require.
    try {
      const { routeMessage } = require('./router');
      const fakeWs = {
        send: () => {}, // we capture via bus RESPONSE_CHUNK instead
        readyState: 1,
      };
      routeMessage({ type: 'chat_message', content: cmd.text }, fakeWs)
        .catch((e) => console.warn('[bridge] route error:', e.message))
        .finally(() => {
          // Give RESPONSE_END a tick to flush, then unblock loop.
          setTimeout(resolve, 250);
        });
    } catch (e) {
      console.warn('[bridge] cannot dispatch:', e.message);
      resolve();
    }
    // safety timeout
    setTimeout(resolve, 90_000);
  });
}

function start() {
  if (!SERVER_URL || !TOKEN) {
    console.log('[bridge] disabled — XJARVIS_SERVER_URL or XJARVIS_SHARED_TOKEN missing');
    return;
  }
  attachReplyCapture();
  console.log(`[bridge] polling ${SERVER_URL} every ${POLL_MS}ms`);
  setInterval(pollOnce, POLL_MS);
  // Kick once immediately
  pollOnce();
}

module.exports = { start };
