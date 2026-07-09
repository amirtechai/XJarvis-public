/**
 * Vision: object/motion detection HUD bridge.
 *
 *   GET  /api/vision-detect/state        → current detections + motion level
 *   POST /api/vision-detect/describe     {image_url?} → calls VISION_MODEL via OpenRouter,
 *                                          returns natural-language description
 *   POST /api/vision-detect/announce-on  → enable spoken announcements when new objects appear
 *   POST /api/vision-detect/announce-off
 *
 * Detection itself runs in the existing Python vision.service (yolov8 / ultralytics).
 * That service POSTs detection events back here on /api/vision-detect/event.
 */
const http = require('http');

const state = {
  last_event_at: 0,
  motion: 0,
  detections: [],            // [{label, confidence, bbox, ts}]
  recent_seen: {},           // label → last_seen_ts (debounce announcements)
  announce: false,
};

const ANNOUNCE_DEBOUNCE_MS = 30_000;

function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on('data', (x) => c.push(x));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf-8')));
  });
}

function shouldHandle(url) { return url.startsWith('/api/vision-detect'); }

function maybeAnnounce(label) {
  if (!state.announce) return;
  const now = Date.now();
  const last = state.recent_seen[label] || 0;
  if (now - last < ANNOUNCE_DEBOUNCE_MS) return;
  state.recent_seen[label] = now;
  // Emit on bus — TTS bridge will pick up RESPONSE_CHUNK and speak
  try {
    const { bus, EVENT_TYPES } = require('./events/bus');
    const lang = (process.env.XJARVIS_LANG || 'tr').toLowerCase();
    const text = lang === 'en' ? `I see a ${label}.` : `${label} görüyorum patron.`;
    bus.emit(EVENT_TYPES.RESPONSE_START, { channel: 'vision' }, 'vision');
    bus.emit(EVENT_TYPES.RESPONSE_CHUNK, { text }, 'vision');
    bus.emit(EVENT_TYPES.RESPONSE_END, {}, 'vision');
  } catch { /* noop */ }
}

// Görsel betimleme artık tek vision yolundan geçer: Python agent :8767
// /vision/describe → Anthropic Agent SDK (abonelik kredisi). OpenRouter/Together YOK.
function describeImage(imageUrl) {
  return new Promise((resolve) => {
    const lang = (process.env.XJARVIS_LANG || 'tr').toLowerCase();
    const query = lang === 'en'
      ? 'Describe what is visible in this image in 2-3 sentences. Mention notable objects, what they are doing, and any context.'
      : 'Bu görüntüde ne görüyorsun? 2-3 cümlede tanımla. Cisimler, ne yaptıkları ve genel bağlam.';
    const body = JSON.stringify({ image_url: imageUrl, query });
    const port = process.env.AGENT_PORT || 8767;
    const req = http.request({
      method: 'POST', host: '127.0.0.1', port, path: '/vision/describe',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 45_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          resolve({ ok: !!j.ok, text: j.text || '', error: j.error });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false, error: 'timeout' }); });
    req.write(body); req.end();
  });
}

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/vision-detect/state') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, ...state }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/vision-detect/event') {
      const b = JSON.parse((await readBody(req)) || '{}');
      state.last_event_at = Date.now();
      state.motion = Number(b.motion ?? 0);
      state.detections = Array.isArray(b.detections) ? b.detections.slice(0, 30) : [];
      // Trigger announcement for any new label
      for (const d of state.detections) {
        if (d.confidence >= 0.55) maybeAnnounce(d.label);
      }
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/vision-detect/describe') {
      const b = JSON.parse((await readBody(req)) || '{}');
      const url = b.image_url || `http://localhost:${process.env.VISION_MJPEG_PORT || 8765}/snap.jpg`;
      const r = await describeImage(url);
      res.writeHead(r.ok ? 200 : 500); res.end(JSON.stringify(r));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/vision-detect/announce-on') {
      state.announce = true;
      res.writeHead(200); res.end(JSON.stringify({ ok: true, announce: true }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/vision-detect/announce-off') {
      state.announce = false;
      res.writeHead(200); res.end(JSON.stringify({ ok: true, announce: false }));
      return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle, state };
