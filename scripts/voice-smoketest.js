#!/usr/bin/env node
/**
 * XJarvis voice-pipeline regression smoke test
 * =============================================
 *
 * HOW TO RUN
 *   1. Start the backend first (it is NOT started by this script):
 *        cd ~/XJarvis && npm run dev:backend
 *        (or: npm run start:backend / the Tauri app, which spawns the same
 *        backend/server.js on port 3001)
 *   2. node scripts/voice-smoketest.js
 *      Optional flags: --host ws://localhost:3001  --timeout 15000
 *      Optional env:   XJARVIS_WS_URL, VOICE_SMOKETEST_TIMEOUT_MS
 *
 * WHAT IT TARGETS (read directly from backend/server.js + backend/router.js
 * + backend/agent-ask.js — nothing here is guessed):
 *
 *   - backend/server.js creates `new WebSocketServer({ server })` on the same
 *     HTTP server listening on PORT = 3001, so the live endpoint is
 *     ws://localhost:3001 (no sub-path).
 *   - Every inbound WS frame must be JSON; server.js does
 *     `msg = JSON.parse(data.toString())` then, for anything that isn't
 *     subscribe/unsubscribe/bus_emit, calls `routeMessage(msg, ws)`
 *     (backend/router.js).
 *   - routeMessage handles `msg.type === 'chat_message' || 'voice_input'`
 *     with `msg.content` as the user text. This script uses 'voice_input'
 *     for every conversational probe because that is the literal envelope
 *     the real voice pipeline sends (see router.js: it runs the fast-route
 *     matcher, vision enrich, and appends the "[VOICE_MODE: ...]" spoken-
 *     style instruction only for voice_input).
 *   - Replies observed on the wire (router.js + xjarvis_agent.js):
 *       { type: 'model_selected', model }
 *       { type: 'stream_chunk', content }   -- 0..n times, concatenate
 *       { type: 'stream_end' }              -- marks a completed turn
 *       { type: 'error', message }          -- routeMessage catch, or
 *                                               xjarvis_agent error event
 *   - There is NO application-level 'ping' message type. router.js's final
 *     branch replies `{ type: 'error', message: 'Unknown message type: ping' }`
 *     to anything unrecognized. So the "ping" probe below does NOT send an
 *     app JSON message — it uses the raw WebSocket protocol ping/pong
 *     (RFC 6455), which the 'ws' server answers automatically. That is the
 *     real heartbeat mechanism that exists in this codebase.
 *
 * The POST /api/agent/ask endpoint (backend/agent-ask.js) was intentionally
 * NOT used here: it spawns openjarvis_ask.py directly and bypasses
 * routeMessage/xjarvis_agent entirely (it's a separate one-shot path built
 * for iOS Shortcuts), so it would not actually regression-test the live
 * voice pipeline.
 *
 * EXIT CODES
 *   0 = all probes passed
 *   1 = one or more probes failed or timed out
 *   2 = could not connect to the backend at all (it's probably not running)
 *
 * This script does not modify any project file; it only talks to the
 * backend over the network.
 */

'use strict';

const path = require('path');

// 'ws' is a dependency of backend/package.json, not of the Next.js root
// package.json, and scripts/ is a sibling of backend/ (not a descendant), so
// plain `require('ws')` will not resolve via normal node_modules walk-up.
// Resolve it explicitly from backend/node_modules, with a plain require()
// fallback in case it's ever hoisted to the root.
let WebSocket;
try {
  WebSocket = require('ws');
} catch {
  try {
    WebSocket = require(path.join(__dirname, '..', 'backend', 'node_modules', 'ws'));
  } catch (err) {
    console.error('[voice-smoketest] Could not load the "ws" package.');
    console.error('  Expected it at backend/node_modules/ws (backend/package.json dependency).');
    console.error(`  Underlying error: ${err.message}`);
    process.exit(2);
  }
}

// ---- CLI / env config -------------------------------------------------

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const WS_URL = argValue('--host') || process.env.XJARVIS_WS_URL || 'ws://localhost:3001';
const PROBE_TIMEOUT_MS = Number(
  argValue('--timeout') || process.env.VOICE_SMOKETEST_TIMEOUT_MS || 15000
);
const CONNECT_TIMEOUT_MS = 5000;

// ---- low-level helpers --------------------------------------------------

/** Raw WS protocol ping → pong (no app-level message involved). */
function pingProbe(ws, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.off('pong', onPong);
      resolve({ ms: timeoutMs, timedOut: true, text: '' });
    }, timeoutMs);

    function onPong() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ms: Date.now() - start, timedOut: false, text: '' });
    }

    ws.once('pong', onPong);
    try {
      ws.ping();
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.off('pong', onPong);
      resolve({ ms: Date.now() - start, timedOut: false, text: '', error: err.message });
    }
  });
}

/**
 * Sends a { type: 'voice_input', content } frame and accumulates
 * stream_chunk content until stream_end / error / timeout.
 */
function sendVoiceInput(ws, content, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    let text = '';
    let settled = false;

    function cleanup() {
      clearTimeout(timer);
      ws.off('message', onMessage);
    }

    function onMessage(raw) {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return; // non-JSON frame, ignore
      }
      if (m.type === 'stream_chunk' && typeof m.content === 'string') {
        text += m.content;
        return;
      }
      if (m.type === 'stream_end') {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ text, ms: Date.now() - start, timedOut: false, error: null });
        return;
      }
      if (m.type === 'error') {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ text, ms: Date.now() - start, timedOut: false, error: m.message || 'unknown error' });
      }
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ text, ms: timeoutMs, timedOut: true, error: null });
    }, timeoutMs);

    ws.on('message', onMessage);
    ws.send(JSON.stringify({ type: 'voice_input', content }));
  });
}

/** Heuristic only: does the reply look like it was cut off mid-sentence? */
function looksTruncated(text) {
  const t = text.trim();
  if (!t) return true;
  const enders = ['.', '!', '?', '…', '"', '”', ')', ':', ';', '»'];
  return !enders.includes(t[t.length - 1]);
}

// ---- probe battery --------------------------------------------------------

async function runProbes(ws) {
  const rows = [];

  // 1) ping — WS protocol-level liveness/heartbeat check.
  {
    const r = await pingProbe(ws, PROBE_TIMEOUT_MS);
    rows.push({
      name: 'ping (WS protocol pong)',
      ms: r.ms,
      pass: !r.timedOut && !r.error,
      truncated: 'n/a',
      note: r.timedOut ? 'no pong within timeout' : r.error || '',
    });
  }

  // 2) exact-instruction-following probe.
  {
    const r = await sendVoiceInput(
      ws,
      'SADECE "hazır" kelimesini yaz. Başka hiçbir kelime, noktalama veya açıklama ekleme.',
      PROBE_TIMEOUT_MS
    );
    const clean = r.text.trim();
    const followedInstruction = /hazır/i.test(clean) && clean.length <= 60;
    rows.push({
      name: 'exact-reply ("Sadece hazır de")',
      ms: r.ms,
      pass: !r.timedOut && !r.error && followedInstruction,
      truncated: r.timedOut ? 'n/a' : looksTruncated(r.text) ? 'y' : 'n',
      note: r.timedOut
        ? 'timed out'
        : r.error
          ? `backend error: ${r.error}`
          : followedInstruction
            ? `reply: "${clean}"`
            : `did not follow instruction, got: "${clean.slice(0, 80)}"`,
    });
  }

  // 3) runaway-generation guard — must TERMINATE within the timeout, must
  //    not hang forever even when asked to do something open-ended.
  {
    const r = await sendVoiceInput(
      ws,
      "1'den başlayarak sonsuza kadar durmadan sayı say, hiç durma, asla bitirme.",
      PROBE_TIMEOUT_MS
    );
    rows.push({
      name: 'loop-forever (terminates, no hang)',
      ms: r.ms,
      pass: !r.timedOut,
      truncated: r.timedOut ? 'n/a' : looksTruncated(r.text) ? 'y' : 'n',
      note: r.timedOut
        ? `HUNG — no stream_end within ${PROBE_TIMEOUT_MS}ms`
        : r.error
          ? `terminated via backend error: ${r.error}`
          : `terminated ok (${r.text.trim().length} chars)`,
    });
  }

  // 4) fixed short-response probes.
  const shortProbes = [
    'Selam, tek cümle cevap ver.',
    'Kısaca kendini tanıt, tek cümle cevap ver.',
  ];
  for (const [i, prompt] of shortProbes.entries()) {
    const r = await sendVoiceInput(ws, prompt, PROBE_TIMEOUT_MS);
    const nonEmpty = r.text.trim().length > 0;
    rows.push({
      name: `short-response #${i + 1} ("${prompt}")`,
      ms: r.ms,
      pass: !r.timedOut && !r.error && nonEmpty,
      truncated: r.timedOut ? 'n/a' : looksTruncated(r.text) ? 'y' : 'n',
      note: r.timedOut
        ? 'timed out'
        : r.error
          ? `backend error: ${r.error}`
          : nonEmpty
            ? `reply: "${r.text.trim().slice(0, 80)}"`
            : 'empty reply',
    });
  }

  return rows;
}

// ---- output -----------------------------------------------------------

function printTable(rows) {
  const cols = [
    { key: 'name', label: 'PROBE', width: 42 },
    { key: 'ms', label: 'LATENCY(ms)', width: 12 },
    { key: 'pass', label: 'RESULT', width: 6 },
    { key: 'truncated', label: 'TRUNC?', width: 6 },
    { key: 'note', label: 'NOTE', width: 60 },
  ];

  const pad = (s, w) => {
    const str = String(s);
    return str.length >= w ? str.slice(0, w - 1) + '…' : str + ' '.repeat(w - str.length);
  };

  const header = cols.map((c) => pad(c.label, c.width)).join(' | ');
  console.log(header);
  console.log(cols.map((c) => '-'.repeat(c.width)).join('-+-'));

  for (const row of rows) {
    const line = cols
      .map((c) => {
        if (c.key === 'pass') return pad(row.pass ? 'PASS' : 'FAIL', c.width);
        return pad(row[c.key], c.width);
      })
      .join(' | ');
    console.log(line);
  }
}

/**
 * Node's dual-stack connector throws an AggregateError with an empty top-
 * level `message` on ECONNREFUSED (the real messages are nested in
 * `err.errors`). Unwrap it so the "backend not running" case prints
 * something a human can actually read.
 */
function describeConnError(err) {
  if (!err) return 'unknown error';
  if (err.message) return err.message;
  if (Array.isArray(err.errors) && err.errors.length) {
    return err.errors.map((e) => e.message || e.code).filter(Boolean).join('; ');
  }
  return err.code || String(err);
}

// ---- main ---------------------------------------------------------------

async function main() {
  console.log(`[voice-smoketest] connecting to ${WS_URL} ...`);

  const ws = new WebSocket(WS_URL);

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), CONNECT_TIMEOUT_MS);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  } catch (err) {
    console.error(`[voice-smoketest] FAILED to connect to ${WS_URL}: ${describeConnError(err)}`);
    console.error('[voice-smoketest] Is the backend running? Start it first with:');
    console.error('  cd ~/XJarvis && npm run dev:backend');
    console.error('  (or: npm run start:backend)');
    process.exit(2);
  }

  console.log('[voice-smoketest] connected. Running calibration battery...\n');

  let rows;
  try {
    rows = await runProbes(ws);
  } finally {
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  console.log('');
  printTable(rows);

  const failed = rows.filter((r) => !r.pass);
  console.log('');
  console.log(
    failed.length === 0
      ? `[voice-smoketest] ALL ${rows.length} PROBES PASSED.`
      : `[voice-smoketest] ${failed.length}/${rows.length} PROBE(S) FAILED: ${failed.map((r) => r.name).join(', ')}`
  );

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[voice-smoketest] unexpected error:', err && err.stack ? err.stack : err);
  process.exit(1);
});
