/**
 * Anki spaced-repetition entegrasyonu — AnkiConnect (http://localhost:8765).
 *
 *   POST /api/anki/cards   {topic|notes, deck?}    → LLM 5-15 kart üretir, Anki'ye gönderir
 *   GET  /api/anki/decks                            → mevcut deck listesi
 *   POST /api/anki/note    {deck, front, back}     → manuel kart ekle
 *
 * AnkiConnect: https://ankiweb.net/shared/info/2055492159 (Anki addon).
 * Anki açık olmazsa istekler 502 döner.
 */
const https = require('https');
const http = require('http');

const ANKI_URL = process.env.ANKI_CONNECT_URL || 'http://127.0.0.1:8765';

function ankiInvoke(action, params = {}) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ action, version: 6, params });
    const u = new URL(ANKI_URL);
    const req = (u.protocol === 'https:' ? https : http).request({
      method: 'POST', host: u.hostname, port: u.port,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          if (j.error) resolve({ ok: false, error: j.error });
          else resolve({ ok: true, result: j.result });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message + ' (Anki açık ve AnkiConnect addon yüklü mü?)' }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false, error: 'timeout' }); });
    req.write(payload); req.end();
  });
}

function callLLMJson(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.5, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-Anki' },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const c = (j.choices?.[0]?.message?.content || '{}').trim().replace(/^```\w*\n?|\n?```$/g, '');
          resolve(JSON.parse(c));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.write(payload); req.end();
  });
}

const CARD_SYS = `Verilen konu/notlardan 5-12 spaced-repetition kart hazırla. Cevap:
{"cards": [{"front": "<soru>", "back": "<cevap>"}]}

Kurallar:
- Kart soruları açık ve tek bir gerçeğe odaklı olsun.
- Cevap kısa, doğru, yan-tutmaz.
- Türkçe.`;

async function createCardsFromTopic({ topic = '', notes = '', deck = 'XJarvis' }) {
  const r = await callLLMJson([
    { role: 'system', content: CARD_SYS },
    { role: 'user', content: `Konu: ${topic}\n\nNotlar:\n${notes || '(yok)'}` },
  ]);
  if (!r?.cards?.length) return { ok: false, error: 'llm_failed' };

  // Ensure deck exists
  await ankiInvoke('createDeck', { deck });

  const notes_payload = r.cards.map((c) => ({
    deckName: deck,
    modelName: 'Basic',
    fields: { Front: c.front, Back: c.back },
    options: { allowDuplicate: false },
    tags: ['xjarvis'],
  }));
  const result = await ankiInvoke('addNotes', { notes: notes_payload });
  if (!result.ok) return { ok: false, error: result.error };
  const added = (result.result || []).filter(Boolean).length;
  return { ok: true, added, total: r.cards.length, cards: r.cards };
}

function shouldHandle(url) { return url.startsWith('/api/anki'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/anki/decks') {
      const r = await ankiInvoke('deckNames');
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/anki/cards') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await createCardsFromTopic(body);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/anki/note') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await ankiInvoke('addNote', {
        note: { deckName: body.deck || 'XJarvis', modelName: 'Basic', fields: { Front: body.front, Back: body.back }, tags: ['xjarvis'] },
      });
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { createCardsFromTopic, shouldHandle, handleHttp };
