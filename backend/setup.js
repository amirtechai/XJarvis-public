/**
 * Setup / Settings API — read+write backend/.env, validate provider keys.
 *
 * GET  /api/setup/status        → which keys are present, which services up
 * POST /api/setup/validate      → { provider, key } → { ok, message }
 * GET  /api/setup/settings      → current model/cap config
 * POST /api/setup/save          → atomically write a subset of env keys
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ENV_PATH = path.join(__dirname, '.env');

const ALLOWED_KEYS = new Set([
  'TOGETHER_API_KEY',
  'DEEPGRAM_API_KEY',
  'OPENAI_API_KEY',
  'PICOVOICE_ACCESS_KEY',
  'WAKE_WORD_PATH',
  'WAKE_SENSITIVITY',
  'LLM_DEFAULT',
  'LLM_HEAVY',
  'LLM_FREE',
  'LLM_DAILY_CAP_USD',
  'STT_LANGUAGE',
]);

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeEnv(updates) {
  const current = readEnv();
  for (const [k, v] of Object.entries(updates)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    if (v === '' || v === null || v === undefined) {
      delete current[k];
    } else {
      current[k] = String(v);
    }
  }
  const lines = Object.entries(current).map(([k, v]) => `${k}=${v}`);
  // Atomic-ish write (tmp file + rename)
  const tmp = `${ENV_PATH}.tmp`;
  fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(tmp, ENV_PATH);
  // Refresh process env so a restart isn't required for new chats
  for (const [k, v] of Object.entries(updates)) {
    if (ALLOWED_KEYS.has(k)) {
      if (v === '' || v == null) delete process.env[k];
      else process.env[k] = String(v);
    }
  }
}

function maskKey(value) {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function probe(url, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function httpsJson(url, options) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: options.method || 'GET',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: options.headers || {},
        timeout: 8000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('validate timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function validateTogether(key) {
  const r = await httpsJson('https://api.together.xyz/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return r.statusCode === 200
    ? { ok: true, message: 'key valid' }
    : { ok: false, message: `Together ${r.statusCode}: ${r.body.slice(0, 120)}` };
}

async function validateDeepgram(key) {
  const r = await httpsJson('https://api.deepgram.com/v1/projects', {
    headers: { Authorization: `Token ${key}` },
  });
  return r.statusCode === 200
    ? { ok: true, message: 'key valid' }
    : { ok: false, message: `Deepgram ${r.statusCode}` };
}

async function validateOpenAI(key) {
  const r = await httpsJson('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return r.statusCode === 200
    ? { ok: true, message: 'key valid' }
    : { ok: false, message: `OpenAI ${r.statusCode}` };
}

async function validateProvider(provider, key) {
  if (!key) return { ok: false, message: 'empty key' };
  switch (provider) {
    case 'together':   return validateTogether(key);
    case 'deepgram':   return validateDeepgram(key);
    case 'openai':     return validateOpenAI(key);
    default:           return { ok: false, message: `unknown provider: ${provider}` };
  }
}

async function dictationTokenHandler(req, res) {
  const env = readEnv();
  const key = env.DEEPGRAM_API_KEY;
  if (!key) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'no_key' }));
    return;
  }
  // NOTE: handing the long-lived key to the browser is acceptable for a
  // single-user local app. For multi-user, swap this for /v1/auth/grant
  // (Deepgram short-lived token endpoint).
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, key }));
}

async function statusHandler(req, res) {
  const env = readEnv();
  const [agentUp, voiceUp, visionUp] = await Promise.all([
    probe('http://127.0.0.1:8767/health'),
    probe('http://127.0.0.1:8766/status'),
    probe('http://127.0.0.1:8765/status'),
  ]);
  const status = {
    keys: {
      TOGETHER_API_KEY: { present: !!env.TOGETHER_API_KEY, masked: maskKey(env.TOGETHER_API_KEY) },
      DEEPGRAM_API_KEY:   { present: !!env.DEEPGRAM_API_KEY,   masked: maskKey(env.DEEPGRAM_API_KEY) },
      OPENAI_API_KEY:     { present: !!env.OPENAI_API_KEY,     masked: maskKey(env.OPENAI_API_KEY) },
      PICOVOICE_ACCESS_KEY: { present: !!env.PICOVOICE_ACCESS_KEY, masked: maskKey(env.PICOVOICE_ACCESS_KEY) },
    },
    services: { agent: agentUp, voice: voiceUp, vision: visionUp },
    setup_complete: !!env.TOGETHER_API_KEY,  // minimum for chat
    voice_ready: !!env.TOGETHER_API_KEY && !!env.DEEPGRAM_API_KEY,
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status));
}

async function settingsHandler(req, res) {
  const env = readEnv();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    LLM_DEFAULT: env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    LLM_HEAVY:   env.LLM_HEAVY   || 'deepseek-ai/DeepSeek-V3',
    LLM_FREE:    env.LLM_FREE    || 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    LLM_DAILY_CAP_USD: env.LLM_DAILY_CAP_USD || '2.00',
    STT_LANGUAGE: env.STT_LANGUAGE || 'tr',
  }));
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function validateHandler(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch { res.writeHead(400); res.end('bad json'); return; }
  const { provider, key } = body || {};
  const result = await validateProvider(provider, key);
  res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

async function saveHandler(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch { res.writeHead(400); res.end('bad json'); return; }
  const updates = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (ALLOWED_KEYS.has(k)) updates[k] = v;
  }
  try {
    writeEnv(updates);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, saved: Object.keys(updates) }));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

function handleHttp(req, res) {
  if (req.method === 'GET' && req.url === '/api/setup/status') return statusHandler(req, res);
  if (req.method === 'GET' && req.url === '/api/setup/settings') return settingsHandler(req, res);
  if (req.method === 'GET' && req.url === '/api/setup/dictation-token') return dictationTokenHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/setup/validate') return validateHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/setup/save') return saveHandler(req, res);
  return null;
}

module.exports = { handleHttp };
