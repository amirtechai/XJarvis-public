/**
 * Aktif LLM modelini in-memory tut, sesli komut + UI'dan değiştirilebilir.
 *   GET  /api/agent/model        → {model}
 *   POST /api/agent/model {id}   → {ok, model}
 *
 * Model değişince LLM_DEFAULT env'i bu süreç için güncellenir; alt servisler
 * (heartbeat, anki, vs.) tekrar bu env'i okuyacağı için yeni model seçilir.
 * Persistent kalması için .env dosyasına da yazılır.
 */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '.env');

// Abonelik SDK modelleri (Claude Agent SDK — API key yok). Together preset'leri
// LLM_PROVIDER=claude geçişiyle kaldırıldı; sesli "modeli değiştir" komutu ve
// /preferences UI bu kısayolları kullanır.
const PRESETS = {
  sonnet:  'claude-sonnet-5',
  sonnet5: 'claude-sonnet-5',
  opus:    'claude-opus-4-8',
  haiku:   'claude-haiku-4-5',
};

function currentModel() {
  return process.env.LLM_DEFAULT || PRESETS.sonnet;
}

function persistEnv(model) {
  try {
    let body = '';
    if (fs.existsSync(ENV_PATH)) body = fs.readFileSync(ENV_PATH, 'utf-8');
    const lines = body.split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^LLM_DEFAULT=/.test(lines[i])) { lines[i] = `LLM_DEFAULT=${model}`; found = true; break; }
    }
    if (!found) lines.push(`LLM_DEFAULT=${model}`);
    fs.writeFileSync(ENV_PATH, lines.join('\n'));
  } catch (e) { /* swallow */ }
}

// İzinli model kümesi: PRESETS anahtar/değerleri + "claude-" ile başlayan
// makul id'ler (ileri uyumluluk). Doğrulanmamış/typo bir id LLM_DEFAULT'a
// yazılırsa canlı ajan kalıcı olarak kırılır (restart'ta da) — BULGU 2 fix.
const VALID_MODELS = new Set([...Object.keys(PRESETS), ...Object.values(PRESETS)]);
function isValidModel(id) {
  return typeof id === 'string' && (VALID_MODELS.has(id) || /^claude-/.test(id));
}

function setModel(idOrFull) {
  const model = PRESETS[(idOrFull || '').toLowerCase()] || idOrFull;
  if (!model || typeof model !== 'string') return { ok: false, error: 'model required' };
  if (!isValidModel(model)) return { ok: false, error: `geçersiz model: ${model}` };
  process.env.LLM_DEFAULT = model;
  persistEnv(model);
  return { ok: true, model };
}

function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}

function shouldHandle(url) { return url.startsWith('/api/agent/model'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify({ model: currentModel(), presets: PRESETS })); return;
  }
  if (req.method === 'POST') {
    // Bozuk JSON body → parse throw eder, try/catch olmadan yanıt hiç
    // gönderilmez ve istek sonsuza kadar askıda kalır (BULGU 3 fix).
    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'invalid json' })); return;
    }
    const r = setModel(body.id || body.model);
    res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
  }
  res.writeHead(405); res.end(JSON.stringify({ error: 'method not allowed' }));
}

module.exports = { shouldHandle, handleHttp, currentModel, setModel, PRESETS };
