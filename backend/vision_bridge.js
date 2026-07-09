const http = require('http');
const { bus, EVENT_TYPES } = require('./events/bus');

const VISION_HOST = process.env.VISION_HOST || 'localhost';
const VISION_PORT = parseInt(process.env.VISION_PORT || '8765', 10);
const TRIGGER_WORDS = [
  'bak', 'baksana', 'ne görüyorsun', 'ne goruyorsun', 'şuna bak', 'suna bak',
  'masamı tara', 'masami tara', 'görsel', 'gorsel', 'kameradan',
  'look at this', 'take a look', 'what do you see', 'scan my desk', "what's in front of you",
];
const PRONOUNS_TR = ['şu ', 'bu ', 'şunu', 'bunu', 'onu ', 'şuna', 'buna', 'ona '];
const PRONOUNS_EN = [' it ', ' it.', ' it,', ' it?', ' that ', ' this '];

let lastVisionContext = null; // { ts, text }
const CONTEXT_TTL_MS = 5 * 60 * 1000;

bus.on(EVENT_TYPES.VISION_RESULT, (envelope) => {
  const p = envelope.payload || {};
  const parts = [];
  if (p.scene_description) parts.push(`Sahne: ${p.scene_description}`);
  if (p.spatial_map && Object.keys(p.spatial_map).length > 0) {
    const sp = Object.entries(p.spatial_map).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
    if (sp) parts.push(`Konumlar: ${sp}`);
  }
  if (Array.isArray(p.text_visible) && p.text_visible.length > 0) {
    parts.push(`Yazılar: ${p.text_visible.join('; ')}`);
  }
  lastVisionContext = { ts: Date.now(), text: parts.join('\n') };
});

function shouldTriggerVision(query) {
  const low = query.toLowerCase();
  for (const t of TRIGGER_WORDS) {
    if (low.includes(t)) return true;
  }
  return false;
}

function hasPronoun(query) {
  const low = ' ' + query.toLowerCase() + ' ';
  return PRONOUNS_TR.some((p) => low.includes(p)) || PRONOUNS_EN.some((p) => low.includes(p));
}

function freshContext() {
  if (!lastVisionContext) return null;
  if (Date.now() - lastVisionContext.ts > CONTEXT_TTL_MS) return null;
  return lastVisionContext.text;
}

async function requestVisionCapture(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = http.request(
      {
        host: VISION_HOST,
        port: VISION_PORT,
        path: '/capture',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 15000,
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(chunks)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('vision timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Maybe enrich a user query with visual context.
 * - If the query has a vision trigger phrase, force a fresh capture.
 * - Else if the query has a pronoun and we have recent context, prepend it.
 * Returns { query: string, augmented: boolean }.
 */
async function enrichWithVision(originalQuery) {
  const trigger = shouldTriggerVision(originalQuery);
  if (trigger) {
    bus.emit(EVENT_TYPES.VISION_TRIGGERED, { query: originalQuery }, 'user');
    try {
      const result = await requestVisionCapture(originalQuery);
      if (result && !result.error) {
        const ctx = [
          result.scene_description && `Sahne: ${result.scene_description}`,
          result.answer_to_query && `Görsel cevap: ${result.answer_to_query}`,
        ].filter(Boolean).join('\n');
        return { query: `[Görsel bağlam]\n${ctx}\n\nKullanıcı: ${originalQuery}`, augmented: true };
      }
    } catch (err) {
      console.warn('[vision] sidecar unreachable:', err.message);
    }
    return { query: originalQuery, augmented: false };
  }

  if (hasPronoun(originalQuery)) {
    const ctx = freshContext();
    if (ctx) {
      return { query: `[Önceki görsel bağlam]\n${ctx}\n\nKullanıcı: ${originalQuery}`, augmented: true };
    }
  }
  return { query: originalQuery, augmented: false };
}

module.exports = { enrichWithVision };
