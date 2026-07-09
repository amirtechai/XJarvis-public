/**
 * Conversation compression — uzun chat history'sini LLM ile özetler.
 *
 *   POST /api/conversation/compress { messages: [{role, content}, …] }
 *      → eğer messages.length > threshold (default 50), ilk N mesajı tek bir
 *        SYSTEM "earlier_summary" mesajına dönüştürür.
 *      → return: { compressed: true|false, messages: [...] }
 *
 * Bu modül *kendi başına* bir storage tutmaz; UI / chat-handler bunu çağırıp
 * yeni mesaj listesini context olarak kullanır.
 */
const https = require('https');

const KEEP_RECENT = parseInt(process.env.XJARVIS_CONVO_KEEP || '20', 10);
const COMPRESS_THRESHOLD = parseInt(process.env.XJARVIS_CONVO_COMPRESS_THRESHOLD || '50', 10);

function callLLM(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.2 });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-Compress' },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          resolve(j.choices?.[0]?.message?.content || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.write(payload); req.end();
  });
}

const SYS = `Aşağıdaki konuşmayı 8-12 cümlede özetle. JARVIS karakteri ve kullanıcının niyeti, kararlar, açık kalan sorular, atılmış aksiyonlar — hepsi korunsun. Türkçe yaz. Cevabın sadece düz metin olsun (başlık/madde işareti yok).`;

async function compressMessages(messages) {
  if (!Array.isArray(messages)) return { compressed: false, messages: [] };
  if (messages.length <= COMPRESS_THRESHOLD) return { compressed: false, messages };

  const cutoff = messages.length - KEEP_RECENT;
  const head = messages.slice(0, cutoff);
  const tail = messages.slice(cutoff);

  // Skip system messages in the head — they should be preserved separately
  const systemMsgs = head.filter((m) => m.role === 'system');
  const dialog = head.filter((m) => m.role !== 'system');
  const transcript = dialog.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

  const summary = await callLLM([
    { role: 'system', content: SYS },
    { role: 'user', content: transcript.slice(0, 12000) },
  ]);

  if (!summary) return { compressed: false, messages };

  const compressedMsg = {
    role: 'system',
    content: `[earlier_summary] ${summary.trim()}`,
  };

  return {
    compressed: true,
    original_length: messages.length,
    compressed_length: systemMsgs.length + 1 + tail.length,
    messages: [...systemMsgs, compressedMsg, ...tail],
  };
}

function shouldHandle(url) { return url.startsWith('/api/conversation/compress'); }
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(JSON.stringify({ error: 'POST only' })); return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const { messages } = JSON.parse(body || '{}');
      const r = await compressMessages(messages);
      res.writeHead(200); res.end(JSON.stringify(r));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
  });
}

module.exports = { compressMessages, shouldHandle, handleHttp };
