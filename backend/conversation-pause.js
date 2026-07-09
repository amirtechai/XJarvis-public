/**
 * Conversation pause/resume — tek seferlik state. Kullanıcı "bir saniye",
 * "dur", "bekle", "wait", "hold on" derse:
 *  - mevcut TTS akışını durdur (/stop)
 *  - SON soruyu hatırla
 *  - "tamam" yanıtı yolla, QUERY'i routerdan geçirme
 * Kullanıcı "tamam devam", "devam et", "continue" derse:
 *  - hatırlanan soruyu routera tekrar yolla (yeniden işle)
 */
const http = require('http');
const { bus, EVENT_TYPES } = require('./events/bus');

const PAUSE_RE = /^(?:bir\s+saniye|saniye\s+bekle|biraz\s+bekle|dur(?:\s+bir)?|bekle|wait|hold\s+on|pause)\b[\s.!,]*$/i;
const RESUME_RE = /^(?:tamam(?:\s+devam)?|devam(?:\s+et)?|continue|go\s+on|ok\s+continue|resume)\b[\s.!,]*$/i;

let lastAgentQuery = null;
let paused = false;

function postVoiceStop() {
  const req = http.request(
    { host: '127.0.0.1', port: 8766, path: '/stop', method: 'POST', timeout: 3000 },
    (res) => res.resume(),
  );
  req.on('error', () => {}); req.on('timeout', () => req.destroy());
  req.end();
}

function streamReply(ws, text) {
  bus.emit(EVENT_TYPES.RESPONSE_START, {}, 'system');
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'stream_chunk', content: text }));
  }
  bus.emit(EVENT_TYPES.RESPONSE_CHUNK, { text }, 'system');
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'stream_end' }));
  }
  bus.emit(EVENT_TYPES.RESPONSE_END, {}, 'system');
}

/**
 * Returns:
 *   { drop: true }                   → query handled, do not route
 *   { rewrite: "<new query>" }       → resume detected, route this instead
 *   null                             → not a pause/resume command
 */
function intercept(content, ws) {
  const trimmed = (content || '').trim();
  if (!trimmed) return null;

  if (PAUSE_RE.test(trimmed)) {
    paused = true;
    postVoiceStop();
    streamReply(ws, 'Tamam, bekliyorum efendim.');
    return { drop: true };
  }

  if (RESUME_RE.test(trimmed)) {
    if (paused && lastAgentQuery) {
      paused = false;
      const q = lastAgentQuery;
      return { rewrite: q };
    }
    paused = false;
    streamReply(ws, 'Devam edecek bir şey yoktu efendim.');
    return { drop: true };
  }
  return null;
}

function noteAgentQuery(content) {
  const t = (content || '').trim();
  if (!t) return;
  // Only remember "real" queries, not the pause/resume control words themselves
  if (PAUSE_RE.test(t) || RESUME_RE.test(t)) return;
  lastAgentQuery = t;
  paused = false;
}

function getState() {
  return { paused, last_query: lastAgentQuery };
}

module.exports = { intercept, noteAgentQuery, getState };
