/**
 * Tek metin-LLM köprüsü — agent (:8767) /llm/complete → Claude Agent SDK (abonelik).
 *
 * Eski desen (api.anthropic.com + ANTHROPIC_API_KEY) key purge'ünden beri ölüydü;
 * vision-detect.js'in :8767/vision/describe deseninin metin karşılığı.
 * Model belirtilmezse agent tarafındaki varsayılan geçerli (LLM_TEXT_MODEL,
 * varsayılan claude-sonnet-5) → tek kaynaklı model yönetimi.
 *
 *   const { complete } = require('./llm-sdk');
 *   const r = await complete({ prompt });        // → {ok, text} | {ok:false, error}
 */
const http = require('http');

const AGENT_PORT = parseInt(process.env.AGENT_PORT || '8767', 10);
const AGENT_DOWN_MSG = 'agent kapalı (XJarvis app açık mı?)';

function complete({ prompt, system, model, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    if (!prompt || !String(prompt).trim()) {
      resolve({ ok: false, error: 'prompt required' });
      return;
    }
    const payload = JSON.stringify({ prompt: String(prompt), system, model });
    const req = http.request({
      method: 'POST', host: '127.0.0.1', port: AGENT_PORT, path: '/llm/complete',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          if (j.ok && j.text) resolve({ ok: true, text: j.text });
          else resolve({ ok: false, error: j.error || `agent llm ${res.statusCode}` });
        } catch {
          resolve({ ok: false, error: `agent llm parse (${res.statusCode})` });
        }
      });
    });
    req.on('error', () => resolve({ ok: false, error: AGENT_DOWN_MSG }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false, error: 'agent llm timeout' }); });
    req.write(payload); req.end();
  });
}

module.exports = { complete, AGENT_DOWN_MSG };
