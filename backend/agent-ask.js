/**
 * One-shot agent endpoint for iOS Shortcuts (and any other plain HTTP client).
 *
 *   POST /api/agent/ask   { prompt: "..." }   → { ok, text, ms }
 *
 * Spawns openjarvis_ask.py, accumulates streamed tokens, returns the joined
 * string when the script writes {"done": true}. Hard timeout 120s.
 */
const path = require('path');
const { spawn } = require('child_process');

function ask(prompt) {
  return new Promise((resolve) => {
    if (!prompt || typeof prompt !== 'string') {
      return resolve({ ok: false, error: 'prompt required' });
    }
    const start = Date.now();
    const proc = spawn(process.env.PYTHON_BIN || 'python3', [
      path.join(__dirname, 'openjarvis_ask.py'), prompt,
    ], { env: { ...process.env, PYTHONPATH: process.env.OPENJARVIS_SRC || '' } });

    const tokens = [];
    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          if (j.t) tokens.push(j.t);
          if (j.err) tokens.push(`\n[err] ${j.err}`);
        } catch {}
      }
    });

    let timer = setTimeout(() => { try { proc.kill(); } catch {} }, 120_000);
    proc.on('close', () => {
      clearTimeout(timer);
      const text = tokens.join('').trim();
      // Async fire-and-forget: feed transcript to profile learner
      if (text.length > 30) {
        try {
          const transcript = `Kullanıcı: ${prompt}\n\nJARVIS: ${text}`;
          const userProfile = require('./user-profile');
          userProfile.learnFromTranscript(transcript).catch(() => {});
        } catch {}
      }
      resolve({ ok: true, text, ms: Date.now() - start });
    });
  });
}

function shouldHandle(url) { return url.startsWith('/api/agent/ask'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(JSON.stringify({ error: 'POST only' })); return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const { prompt } = JSON.parse(body || '{}');
      const r = await ask(prompt);
      res.writeHead(r.ok ? 200 : 400);
      res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
  });
}

module.exports = { ask, shouldHandle, handleHttp };
