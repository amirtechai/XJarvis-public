/**
 * Voice configuration API.
 *
 *   GET  /api/voice/list     → mevcut macOS sesleri (say -v '?')
 *   GET  /api/voice/state    → seçili ses + rate + backend tipi
 *   POST /api/voice/set      → {voice?, rate?} .env'ye yazar
 *   POST /api/voice/preview  → {text?, voice?, rate?} say ile önizler
 *
 * Voice servisinin değişikliği görmesi için yeniden başlatılması gerekir
 * (launchctl kickstart -k gui/$UID/com.jarvis.voice). UI bunu kullanıcıya bildirir.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const ENV_PATH = path.join(__dirname, '.env');

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

function listVoices() {
  return new Promise((resolve) => {
    execFile('say', ['-v', '?'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([]);
      const voices = [];
      for (const raw of stdout.split('\n')) {
        const line = raw.trimEnd();
        if (!line) continue;
        // "Name (suffix)?  locale  # sample"
        const m = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s*#\s*(.+)$/);
        if (!m) continue;
        const [, name, locale, sample] = m;
        voices.push({ name: name.trim(), locale, sample: sample.trim() });
      }
      // Sort: TR önce, sonra EN, sonra alfabetik
      voices.sort((a, b) => {
        const score = (v) => v.locale === 'tr_TR' ? 0 : v.locale.startsWith('en') ? 1 : 2;
        const d = score(a) - score(b);
        if (d) return d;
        return a.name.localeCompare(b.name);
      });
      resolve(voices);
    });
  });
}

function getState() {
  const env = readEnv();
  return {
    backend: (env.XJARVIS_TTS_BACKEND || 'native').toLowerCase(),
    voice: env.MACOS_TTS_VOICE || 'Yelda',
    rate: parseInt(env.MACOS_TTS_RATE || '190', 10),
    language: (env.XJARVIS_LANG || 'tr').toLowerCase(),
    openai_enabled: !!env.OPENAI_API_KEY,
    openai_voice: env.OPENAI_TTS_VOICE || 'onyx',
    openai_voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
    eleven_enabled: !!env.ELEVENLABS_API_KEY,
    eleven_voice_id: env.ELEVENLABS_VOICE_ID || '',
    eleven_model: env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5',
  };
}

function elevenList(apiKey) {
  return new Promise((resolve) => {
    const req = https.request({
      method: 'GET', host: 'api.elevenlabs.io', path: '/v1/voices',
      headers: { 'xi-api-key': apiKey, 'Accept': 'application/json' },
      timeout: 10_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const voices = (j.voices || []).map((v) => ({
            id: v.voice_id,
            name: (v.name || '').split(' - ')[0],
            description: (v.name || '').split(' - ')[1] || '',
            gender: v.labels?.gender || '?',
            accent: v.labels?.accent || '-',
            age: v.labels?.age || '-',
          }));
          resolve({ ok: true, voices });
        } catch { resolve({ ok: false, error: 'parse failed' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

function elevenPreview(apiKey, voiceId, modelId, text) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      text, model_id: modelId,
      voice_settings: { stability: 0.4, similarity_boost: 0.85 },
    });
    const tmp = `/tmp/xjarvis-voice-preview-${Date.now()}.mp3`;
    const out = fs.createWriteStream(tmp);
    const req = https.request({
      method: 'POST', host: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 30_000,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); out.close();
        return resolve({ ok: false, error: `eleven status ${res.statusCode}` });
      }
      res.pipe(out);
      out.on('finish', () => {
        execFile('afplay', [tmp], { timeout: 30_000 }, (err) => {
          fs.unlink(tmp, () => {});
          if (err) resolve({ ok: false, error: err.message });
          else resolve({ ok: true });
        });
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false, error: 'timeout' }); });
    req.write(payload); req.end();
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function previewSay(voice, rate, text, cb) {
  const args = ['-v', voice, '-r', String(rate || 190), text];
  execFile('say', args, { timeout: 12_000 }, (err) => cb(err));
}

/**
 * ElevenLabs voice cloning — POST audio sample, get a new voice_id.
 * https://elevenlabs.io/docs/api-reference/voices/add
 */
function elevenClone(apiKey, name, audioPath, description) {
  return new Promise((resolve) => {
    const fs2 = require('fs');
    if (!fs2.existsSync(audioPath)) return resolve({ ok: false, error: 'audio file not found' });
    const audio = fs2.readFileSync(audioPath);
    const boundary = `----xjarvis${Date.now()}`;
    const parts = [];
    const append = (s) => parts.push(Buffer.from(s));
    append(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`);
    if (description) {
      append(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description}\r\n`);
    }
    append(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${path.basename(audioPath)}"\r\nContent-Type: audio/mpeg\r\n\r\n`);
    parts.push(audio);
    append(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat(parts);
    const req = https.request({
      method: 'POST', host: 'api.elevenlabs.io', path: '/v1/voices/add',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 60_000,
    }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(cs).toString());
          resolve(res.statusCode === 200 ? { ok: true, voice_id: j.voice_id, raw: j } : { ok: false, error: j.detail?.message || `status ${res.statusCode}`, raw: j });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false, error: 'timeout' }); });
    req.write(body); req.end();
  });
}

function shouldHandle(url) { return url.startsWith('/api/voice/'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && u.pathname === '/api/voice/list') {
      const voices = await listVoices();
      res.writeHead(200); res.end(JSON.stringify({ ok: true, voices }));
      return;
    }

    if (req.method === 'GET' && u.pathname === '/api/voice/state') {
      res.writeHead(200); res.end(JSON.stringify({ ok: true, ...getState() }));
      return;
    }

    if (req.method === 'GET' && u.pathname === '/api/voice/eleven/list') {
      const env = readEnv();
      if (!env.ELEVENLABS_API_KEY) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'ELEVENLABS_API_KEY yok' }));
        return;
      }
      const r = await elevenList(env.ELEVENLABS_API_KEY);
      res.writeHead(200); res.end(JSON.stringify(r));
      return;
    }

    if (req.method === 'POST' && u.pathname === '/api/voice/eleven/preview') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const env = readEnv();
      if (!env.ELEVENLABS_API_KEY) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'ELEVENLABS_API_KEY yok' }));
        return;
      }
      const voiceId = (body.voice_id || env.ELEVENLABS_VOICE_ID || '').toString();
      if (!voiceId) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'voice_id gerekli' }));
        return;
      }
      const text = (body.text || 'Merhaba efendim. Ben XJarvis. Sesimi nasıl buldunuz?').toString().slice(0, 240);
      const model = (body.model_id || env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5').toString();
      const r = await elevenPreview(env.ELEVENLABS_API_KEY, voiceId, model, text);
      res.writeHead(r.ok ? 200 : 500); res.end(JSON.stringify(r));
      return;
    }

    if (req.method === 'POST' && u.pathname === '/api/voice/set') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const patch = {};
      if (typeof body.backend === 'string' && ['native', 'elevenlabs'].includes(body.backend.toLowerCase())) {
        patch.XJARVIS_TTS_BACKEND = body.backend.toLowerCase();
      }
      if (typeof body.voice === 'string' && body.voice.trim()) {
        patch.MACOS_TTS_VOICE = body.voice.trim().slice(0, 80);
      }
      if (typeof body.rate === 'number' && body.rate >= 100 && body.rate <= 320) {
        patch.MACOS_TTS_RATE = String(Math.round(body.rate));
      }
      if (typeof body.openai_voice === 'string' && body.openai_voice.trim()) {
        patch.OPENAI_TTS_VOICE = body.openai_voice.trim().slice(0, 30);
      }
      if (typeof body.eleven_voice_id === 'string' && body.eleven_voice_id.trim()) {
        patch.ELEVENLABS_VOICE_ID = body.eleven_voice_id.trim().slice(0, 50);
      }
      if (typeof body.language === 'string') {
        const lang = body.language.toLowerCase();
        if (lang === 'tr' || lang === 'en') {
          patch.XJARVIS_LANG = lang;
          // Auto-pick a sensible default voice for the new language
          if (!body.voice) {
            patch.MACOS_TTS_VOICE = lang === 'en' ? 'Samantha' : 'Yelda';
          }
        }
      }
      if (Object.keys(patch).length === 0) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'nothing to save' }));
        return;
      }
      writeEnvPatch(patch);
      res.writeHead(200); res.end(JSON.stringify({ ok: true, state: getState(), restart_required: true }));
      return;
    }

    if (req.method === 'POST' && u.pathname === '/api/voice/preview') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const voice = (body.voice || readEnv().MACOS_TTS_VOICE || 'Yelda').toString().slice(0, 80);
      const rate = Number(body.rate) || parseInt(readEnv().MACOS_TTS_RATE || '190', 10);
      const text = (body.text || 'Merhaba, ben XJarvis. Sesimi seçtiğin için teşekkür ederim.').toString().slice(0, 240);
      previewSay(voice, rate, text, (err) => {
        if (err) {
          res.writeHead(500); res.end(JSON.stringify({ ok: false, error: err.message }));
        } else {
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        }
      });
      return;
    }

    if (req.method === 'POST' && u.pathname === '/api/voice/upload-sample') {
      // Plain multipart not parsed here — accept raw body and write to /tmp
      const chunks = [];
      await new Promise((resolve) => {
        req.on('data', (c) => chunks.push(c));
        req.on('end', resolve);
      });
      const buf = Buffer.concat(chunks);
      // Skip multipart boundary parsing — most browsers send single-file webm/mp3
      const ct = (req.headers['content-type'] || '').toString();
      let body = buf;
      const m = ct.match(/boundary=(.+)$/);
      if (m) {
        const boundary = `--${m[1]}`;
        const text = buf.toString('binary');
        const partStart = text.indexOf('\r\n\r\n');
        const partEnd = text.lastIndexOf(`\r\n${boundary}--`);
        if (partStart > 0 && partEnd > partStart) {
          body = Buffer.from(text.slice(partStart + 4, partEnd), 'binary');
        }
      }
      const ext = ct.includes('webm') ? 'webm' : ct.includes('wav') ? 'wav' : 'mp3';
      const out = `/tmp/xjarvis-voice-sample-${Date.now()}.${ext}`;
      fs.writeFileSync(out, body);
      res.writeHead(200); res.end(JSON.stringify({ ok: true, path: out, size: body.length }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/voice/eleven/clone') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const env = readEnv();
      if (!env.ELEVENLABS_API_KEY) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'ELEVENLABS_API_KEY yok' }));
        return;
      }
      if (!body.audio_path || !body.name) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'audio_path + name gerekli' }));
        return;
      }
      const r = await elevenClone(env.ELEVENLABS_API_KEY, body.name, body.audio_path, body.description || '');
      if (r.ok && body.set_active) {
        writeEnvPatch({ ELEVENLABS_VOICE_ID: r.voice_id });
      }
      res.writeHead(r.ok ? 200 : 500); res.end(JSON.stringify(r));
      return;
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle, listVoices, getState };
