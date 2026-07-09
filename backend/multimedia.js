/**
 * J1 image generation + J2 OCR + J3 NotebookLM-style podcast + J4 sketch-to-code.
 *
 * Hepsi tek modülde toplu: bunlar HTTP endpoint katmanı; ağır iş LLM/Vision API'larında.
 *
 *   POST /api/media/image-gen   {prompt, size?, count?}
 *   POST /api/media/ocr         {file_path}                  → macOS Vision (osascript shortcut)
 *   POST /api/media/podcast     {topic, sources_text}        → script + TTS audio
 *   POST /api/media/sketch-code {file_path, framework?}      → vision LLM → kod
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const https = require('https');
const { exec, spawn } = require('child_process');

function osa(script, ms = 12000) {
  return new Promise((resolve) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: ms }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || stderr || '').trim() });
    });
  });
}

// ---------------------------------------------------------------------------
// J1 — Image generation via OpenAI gpt-image-1 (preferred) or fallback.
// ---------------------------------------------------------------------------
function callImageGen({ prompt, size = '1024x1024', count = 1 }) {
  return new Promise((resolve) => {
    const key = (process.env.OPENAI_API_KEY || '').trim();
    if (!key) return resolve({ ok: false, error: 'OPENAI_API_KEY not set' });
    const payload = JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      prompt, size, n: Math.max(1, Math.min(4, count)),
    });
    const req = https.request('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 120_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', async () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          if (j.error) return resolve({ ok: false, error: j.error.message });
          const out = [];
          for (const item of j.data || []) {
            if (item.b64_json) {
              const fname = `/tmp/xjarvis-img-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
              await fsp.writeFile(fname, Buffer.from(item.b64_json, 'base64'));
              out.push(fname);
            } else if (item.url) {
              out.push(item.url);
            }
          }
          resolve({ ok: true, files: out });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false, error: 'timeout' }); });
    req.write(payload); req.end();
  });
}

// ---------------------------------------------------------------------------
// J2 — Document scanner / OCR via macOS Vision Framework.
// Uses the `shortcuts` CLI to invoke a built-in "Extract Text from Image" Shortcut.
// ---------------------------------------------------------------------------
async function ocr(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'file not found' };
  // macOS Sequoia/Tahoe ships with the "Extract Text from Image" Shortcut by default.
  // Output is text on stdout.
  const cmd = `shortcuts run "Extract Text from Image" -i "${filePath.replace(/"/g, '\\"')}" 2>/dev/null`;
  return new Promise((resolve) => {
    exec(cmd, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: stderr || err.message, hint: 'macOS\'ta "Extract Text from Image" shortcut\'unun yüklü olması gerek (Shortcuts.app > Gallery > Extract Text from Image > +)' });
      resolve({ ok: true, text: stdout.trim() });
    });
  });
}

// ---------------------------------------------------------------------------
// J3 — NotebookLM-style audio podcast.
// Pipeline: source_text → LLM script (2 voices, 3-5min) → TTS (ElevenLabs) → mp3.
// ---------------------------------------------------------------------------
function llmJson(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.7, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-Podcast' },
      timeout: 120_000,
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

const PODCAST_SYS = `Sen "XJarvis Daily" adlı 5 dakikalık iki sunuculu Türkçe podcast yazarlığı yapıyorsun. İki sunucu: HOST_A (analitik, sakin) ve HOST_B (meraklı, soru-soran). Verilen kaynaklardan gerçek-temelli, akıcı bir dialog yaz.

Cevap:
{
  "title": "<bölüm başlığı>",
  "intro": "<HOST_A intro 2-3 cümle>",
  "lines": [{"speaker": "HOST_A|HOST_B", "text": "..."}],
  "outro": "<HOST_A kapanış>"
}`;

async function elevenSpeakToFile(text, voiceId) {
  const key = (process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key || !voiceId) return null;
  const payload = JSON.stringify({
    text,
    model_id: process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5',
    voice_settings: { stability: 0.4, similarity_boost: 0.85 },
  });
  return new Promise((resolve) => {
    const req = https.request({
      method: 'POST',
      host: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 120_000,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const fname = `/tmp/xjarvis-podcast-line-${Date.now()}-${Math.floor(Math.random() * 1e6)}.mp3`;
      const out = fs.createWriteStream(fname);
      res.pipe(out);
      out.on('finish', () => resolve(fname));
      out.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.write(payload); req.end();
  });
}

function ffmpegConcat(inputs, output) {
  return new Promise((resolve) => {
    if (!inputs.length) return resolve({ ok: false });
    const listPath = `/tmp/xjarvis-podcast-list-${Date.now()}.txt`;
    fs.writeFileSync(listPath, inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
    const proc = spawn('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', output]);
    proc.on('close', (code) => {
      try { fs.unlinkSync(listPath); } catch {}
      resolve({ ok: code === 0, output });
    });
  });
}

async function generatePodcast({ topic, sources_text = '' }) {
  const llm = await llmJson([
    { role: 'system', content: PODCAST_SYS },
    { role: 'user', content: `Konu: ${topic}\n\nKaynaklar:\n${sources_text || '(genel bilgi kullan)'}\n\n5 dakikalık dialog yaz.` },
  ]);
  if (!llm) return { ok: false, error: 'llm_failed' };

  const voiceA = process.env.ELEVENLABS_VOICE_A || process.env.ELEVENLABS_VOICE_ID || '';
  const voiceB = process.env.ELEVENLABS_VOICE_B || voiceA;
  if (!voiceA) return { ok: false, error: 'ELEVENLABS_VOICE_ID set edilmemiş', script: llm };

  const lines = [
    { speaker: 'HOST_A', text: llm.intro || '' },
    ...(llm.lines || []),
    { speaker: 'HOST_A', text: llm.outro || '' },
  ].filter((l) => l.text);

  const files = [];
  for (const l of lines) {
    const f = await elevenSpeakToFile(l.text, l.speaker === 'HOST_B' ? voiceB : voiceA);
    if (f) files.push(f);
  }
  if (!files.length) return { ok: false, error: 'tts_failed', script: llm };

  const finalPath = path.join(os.homedir(), 'Documents', `xjarvis-podcast-${Date.now()}.mp3`);
  const concat = await ffmpegConcat(files, finalPath);
  // Cleanup line mp3s
  for (const f of files) { try { fs.unlinkSync(f); } catch {} }
  if (!concat.ok) return { ok: false, error: 'ffmpeg_failed', hint: 'brew install ffmpeg', script: llm };

  return { ok: true, file: finalPath, script: llm, line_count: lines.length };
}

// ---------------------------------------------------------------------------
// J4 — Sketch / whiteboard photo → code (vision LLM).
// ---------------------------------------------------------------------------
async function sketchToCode({ file_path, framework = 'react' }) {
  if (!file_path || !fs.existsSync(file_path)) return { ok: false, error: 'file not found' };
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'TOGETHER_API_KEY not set' };

  const buf = await fsp.readFile(file_path);
  const b64 = buf.toString('base64');
  const ext = path.extname(file_path).slice(1).toLowerCase() || 'jpeg';

  const sys = `Sen UI eskizinden kod üreten bir geliştiricisin. Kullanıcı sana çizim/fotoğraf veriyor; sen ${framework} component kodu yazıyorsun. Türkçe açıklama yapma; sadece tek dosyalık, çalışır, tipli kod ver. Kod fence kullan.`;

  const payload = JSON.stringify({
    model: process.env.LLM_VISION_MODEL || 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: [
        { type: 'text', text: `Bu eskizi ${framework} component'ine çevir.` },
        { type: 'image_url', image_url: { url: `data:image/${ext};base64,${b64}` } },
      ] },
    ],
    temperature: 0.4,
    max_tokens: 3000,
  });

  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-Sketch' },
      timeout: 120_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const code = j.choices?.[0]?.message?.content || '';
          resolve({ ok: true, code, framework });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false, error: 'timeout' }); });
    req.write(payload); req.end();
  });
}

// ---------------------------------------------------------------------------
// HTTP wiring
// ---------------------------------------------------------------------------
function shouldHandle(url) { return url.startsWith('/api/media'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
    if (req.method === 'POST' && req.url === '/api/media/image-gen') {
      const r = await callImageGen(body);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && req.url === '/api/media/ocr') {
      const r = await ocr(body.file_path);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && req.url === '/api/media/podcast') {
      const r = await generatePodcast(body);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && req.url === '/api/media/sketch-code') {
      const r = await sketchToCode(body);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { callImageGen, ocr, generatePodcast, sketchToCode, shouldHandle, handleHttp };
