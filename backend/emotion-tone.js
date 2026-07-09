/**
 * Emotional tone detection — text-only heuristic + LLM fallback.
 *
 *   POST /api/emotion/analyze {text}
 *     → {tone, confidence, suggested_response_style}
 *
 * Heuristic categories: stress, urgency, frustration, joy, sadness, neutral.
 * The agent loop reads `XJARVIS_LAST_TONE` env / bus event to soften reply.
 */
const https = require('https');
const { bus, EVENT_TYPES } = require('./events/bus');

function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on('data', (x) => c.push(x));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf-8')));
  });
}

const TONE_RULES = [
  { id: 'urgency',     re: /\b(asap|acil|urgent|hemen|şimdi|now|deadline|bitir|geciktim|stuck)\b/i, style: 'short, direct, no filler' },
  { id: 'frustration', re: /\b(saçma|berbat|nefret|bug|kırıldı|broken|fuck|damn|wtf|işe yaramıyor|not working)\b/i, style: 'acknowledge issue, propose fix without blame' },
  { id: 'stress',      re: /\b(yetişemiyorum|yorgun|tired|exhausted|stressed|baş edemiyorum|overwhelmed)\b/i, style: 'soft tone, offer to help triage' },
  { id: 'joy',         re: /\b(harika|süper|mükemmel|👏|🎉|awesome|excellent|love it)\b/i, style: 'match enthusiasm, keep momentum' },
  { id: 'sadness',     re: /\b(üzgün|kederli|sad|down|hurt|kayboldum|lost)\b/i, style: 'gentle, reassuring, ask if support needed' },
];

function heuristic(text) {
  const t = text.toLowerCase();
  for (const r of TONE_RULES) {
    if (r.re.test(t)) return { tone: r.id, confidence: 0.6, suggested_response_style: r.style };
  }
  // Caps + exclamation density
  const upperRatio = (text.match(/[A-ZĞÜŞIÖÇ]/g)?.length || 0) / Math.max(1, text.length);
  if (upperRatio > 0.5 && text.length > 8) {
    return { tone: 'frustration', confidence: 0.45, suggested_response_style: 'acknowledge issue, propose fix without blame' };
  }
  if ((text.match(/[!?]/g)?.length || 0) >= 3) {
    return { tone: 'urgency', confidence: 0.4, suggested_response_style: 'short, direct, no filler' };
  }
  return { tone: 'neutral', confidence: 0.3, suggested_response_style: 'standard tone' };
}

function shouldHandle(url) { return url.startsWith('/api/emotion/'); }

let lastTone = { tone: 'neutral', ts: 0 };

bus.on(EVENT_TYPES.STT_FINAL, (payload) => {
  const text = payload?.text || '';
  if (!text) return;
  const t = heuristic(text);
  lastTone = { ...t, ts: Date.now() };
  process.env.XJARVIS_LAST_TONE = t.tone;
});

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/api/emotion/last') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, ...lastTone }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/emotion/analyze') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const text = String(body.text || '').slice(0, 2000);
    const r = heuristic(text);
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, ...r, text_length: text.length }));
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { handleHttp, shouldHandle, heuristic };
