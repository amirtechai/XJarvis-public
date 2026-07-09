/**
 * Wake-word config API (openWakeWord).
 *
 * Picovoice'tan farklı olarak access key veya .ppn dosyası gerekmez.
 * Hazır modeller: hey_jarvis, alexa, hey_mycroft, hey_rhasspy.
 *
 *   GET  /api/wake/state              → mevcut model + threshold + framework
 *   POST /api/wake/save  body: {model?, threshold?, framework?}
 *   POST /api/wake/test               → /wake endpoint'ini tetikle (manuel test)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ENV_PATH = path.join(__dirname, '.env');

const BUILTIN_MODELS = [
  { id: 'hey_jarvis',   label: 'Hey Jarvis',   recommended: true  },
  { id: 'alexa',        label: 'Alexa',        recommended: false },
  { id: 'hey_mycroft',  label: 'Hey Mycroft',  recommended: false },
  { id: 'hey_rhasspy',  label: 'Hey Rhasspy',  recommended: false },
];

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeEnvPatch(patch) {
  const env = readEnv();
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v == null) delete env[k];
    else env[k] = String(v);
    if (v === '' || v == null) delete process.env[k];
    else process.env[k] = String(v);
  }
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(`${ENV_PATH}.tmp`, lines.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(`${ENV_PATH}.tmp`, ENV_PATH);
}

function getState() {
  const env = readEnv();
  return {
    engine: 'openWakeWord',
    model: env.WAKE_MODEL || 'hey_jarvis',
    threshold: parseFloat(env.WAKE_THRESHOLD || '0.5'),
    framework: env.WAKE_INFERENCE || 'onnx',
    enabled: env.ENABLE_WAKE_WORD !== 'false',
    builtin_models: BUILTIN_MODELS,
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function savePatch(req, res) {
  const body = JSON.parse((await readBody(req)) || '{}');
  const patch = {};
  if (typeof body.model === 'string' && body.model.trim()) {
    patch.WAKE_MODEL = body.model.trim().slice(0, 80);
  }
  if (typeof body.threshold === 'number' && body.threshold >= 0 && body.threshold <= 1) {
    patch.WAKE_THRESHOLD = body.threshold.toFixed(2);
  }
  if (typeof body.framework === 'string' && ['onnx', 'tflite'].includes(body.framework)) {
    patch.WAKE_INFERENCE = body.framework;
  }
  if (typeof body.enabled === 'boolean') {
    patch.ENABLE_WAKE_WORD = body.enabled ? 'true' : 'false';
  }
  if (Object.keys(patch).length === 0) {
    return json(res, 400, { ok: false, error: 'nothing to save' });
  }
  writeEnvPatch(patch);
  return json(res, 200, { ok: true, state: getState(), restart_required: true });
}

function triggerTest(res) {
  const req = http.request(
    { host: '127.0.0.1', port: 8766, path: '/wake', method: 'POST', timeout: 4000 },
    (r) => { r.resume(); r.on('end', () => json(res, 200, { ok: r.statusCode === 200 })); },
  );
  req.on('error', (e) => json(res, 502, { ok: false, error: e.message }));
  req.on('timeout', () => { req.destroy(); json(res, 504, { ok: false, error: 'voice timeout' }); });
  req.end();
}

async function handleHttp(req, res) {
  const url = req.url || '';
  if (url === '/api/wake/state' && req.method === 'GET') return json(res, 200, getState());
  if (url === '/api/wake/save' && req.method === 'POST') return savePatch(req, res);
  if (url === '/api/wake/test' && req.method === 'POST') return triggerTest(res);
  return json(res, 404, { error: 'not found' });
}

function shouldHandle(url) { return url.startsWith('/api/wake/'); }

module.exports = { handleHttp, shouldHandle };
