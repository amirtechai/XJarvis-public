/**
 * AI Podcast Studio — NotebookLM-style 2-voice generation.
 *
 *   POST /api/podcast/script {topic, length_min?} → script (alternating speakers)
 *   POST /api/podcast/render {script, voice_a, voice_b} → mp3 path
 *
 * Script: Claude (agent :8767, abonelik SDK) generates Q&A dialogue.
 * Render: Each line synthesized via ElevenLabs, concatenated with ffmpeg.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFile } = require('child_process');
const llm = require('./llm-sdk');

function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on('data', (x) => c.push(x));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf-8')));
  });
}

function elevenSynth(text, voiceId, key) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      text, model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.4, similarity_boost: 0.85 },
    });
    const tmp = `/tmp/podcast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`;
    const out = fs.createWriteStream(tmp);
    let resolved = false;
    const req = https.request({
      method: 'POST', host: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
      headers: {
        'xi-api-key': key, 'Content-Type': 'application/json',
        Accept: 'audio/mpeg', 'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60_000,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        out.destroy();
        fs.unlink(tmp, () => {});
        if (!resolved) {
          resolved = true;
          resolve({ ok: false, error: `eleven ${res.statusCode}` });
        }
        return;
      }
      res.pipe(out);
      out.on('finish', () => {
        if (!resolved) {
          resolved = true;
          resolve({ ok: true, path: tmp });
        }
      });
    });
    req.on('error', (e) => {
      out.destroy();
      fs.unlink(tmp, () => {});
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, error: e.message });
      }
    });
    req.on('timeout', () => {
      try { req.destroy(); } catch {}
      out.destroy();
      fs.unlink(tmp, () => {});
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, error: 'timeout' });
      }
    });
    out.on('error', () => {
      out.destroy();
      fs.unlink(tmp, () => {});
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, error: 'write_error' });
      }
    });
    req.write(payload); req.end();
  });
}

function ffmpegConcat(parts, output) {
  return new Promise((resolve) => {
    const listFile = `/tmp/concat-${Date.now()}.txt`;
    fs.writeFileSync(listFile, parts.map((p) => `file '${p}'`).join('\n'));
    execFile('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output], { timeout: 120_000 }, (err) => {
      if (err) {
        try { fs.unlinkSync(listFile); } catch { /* noop */ }
        resolve({ ok: false, error: err.message });
      } else {
        try { fs.unlinkSync(listFile); } catch { /* noop */ }
        resolve({ ok: true, path: output });
      }
    });
  });
}

function shouldHandle(url) { return url.startsWith('/api/podcast/'); }

async function handleHttp(req, res) {
  // Bozuk JSON body (JSON.parse throw) veya dosya-sistemi hatası try/catch
  // olmadan isteği askıda bırakıyordu — top-level sar (BULGU 4 fix).
  try {
    await handleHttpInner(req, res);
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }
}

async function handleHttpInner(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/api/podcast/script') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const topic = String(body.topic || '').slice(0, 600);
    const lengthMin = Math.max(2, Math.min(15, parseInt(body.length_min, 10) || 5));
    if (!topic) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'topic required' })); return; }
    const lang = (process.env.XJARVIS_LANG || 'tr').toLowerCase();
    const prompt = lang === 'en'
      ? `Write a ${lengthMin}-minute 2-host podcast script about: "${topic}". Format strictly as alternating lines:
HOST_A: ...
HOST_B: ...
HOST_A asks questions and challenges. HOST_B explains in plain language with examples. Total 18-30 turns. No filler. End with a memorable takeaway.`
      : `"${topic}" hakkında ${lengthMin} dakikalık iki sunuculu podcast senaryosu yaz. Sıkı format:
SUNUCU_A: ...
SUNUCU_B: ...
A soru sorar ve eleştirir. B sade dille örneklerle anlatır. Toplam 18-30 satır. Dolgu yok. Akılda kalan bir cümleyle bitir.`;
    const r = await llm.complete({ prompt });
    if (!r.ok) { res.writeHead(500); res.end(JSON.stringify(r)); return; }
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, script: r.text, lines: r.text.split('\n').filter((l) => /^(HOST|SUNUCU)/.test(l)) }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/podcast/render') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const script = String(body.script || '');
    const voiceA = body.voice_a || 'JBFqnCBsd6RMkjVDRZzb'; // George
    const voiceB = body.voice_b || 'EXAVITQu4vr4xnSDxMaL'; // Sarah
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) { res.writeHead(503); res.end(JSON.stringify({ ok: false, error: 'ELEVENLABS_API_KEY missing' })); return; }
    const lines = script.split('\n').map((l) => l.trim()).filter((l) => /^(HOST|SUNUCU)_?[AB]:/i.test(l));
    if (!lines.length) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'no speaker lines parsed' })); return; }
    const parts = [];
    for (const line of lines.slice(0, 60)) {
      const isA = /^(HOST|SUNUCU)_?A:/i.test(line);
      const text = line.replace(/^(HOST|SUNUCU)_?[AB]:\s*/i, '').slice(0, 800);
      if (!text) continue;
      const r = await elevenSynth(text, isA ? voiceA : voiceB, key);
      if (r.ok) parts.push(r.path);
    }
    if (!parts.length) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: 'no audio rendered' })); return; }
    const output = path.join(os.homedir(), '.config', 'xjarvis', `podcast-${Date.now()}.mp3`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const concat = await ffmpegConcat(parts, output);
    parts.forEach((p) => { try { fs.unlinkSync(p); } catch { /* noop */ } });
    if (!concat.ok) { res.writeHead(500); res.end(JSON.stringify(concat)); return; }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, path: output, lines_synthesized: parts.length }));
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { handleHttp, shouldHandle };
