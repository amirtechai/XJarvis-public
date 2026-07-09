/**
 * TTS bridge — streaming. Yanıt akışı geldikçe cümle sınırlarında parçalayıp
 * voice servisine /speak isteği yollar; sonraki cümleler kuyruğa alınır.
 *
 * Voice servisi bir istek bittiğinde dönüyorsa, kuyruğun sırayla işlenmesi
 * sayesinde "fragment çakışması" olmaz. Streaming sayesinde TTS'in başlama
 * anı, modelin tüm yanıtı bitirmesini beklemekten ~1-3 sn önce gelir.
 *
 * Sadece son STT_FINAL'den VOICE_WINDOW_MS içindeyse aktif.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');
const { bus, EVENT_TYPES } = require('./events/bus');

const VOICE_HOST = '127.0.0.1';
const VOICE_PORT = parseInt(process.env.VOICE_TTS_PORT || '8766', 10);

// ElevenLabs voice cloning. When XJARVIS_TTS_BACKEND=elevenlabs and the
// API key + voice id are set, we synthesize via ElevenLabs and pipe the
// MP3 through afplay instead of the local voice service. Falls back to
// the macOS native voice service silently on any failure.
const TTS_BACKEND = (process.env.XJARVIS_TTS_BACKEND || 'edge').toLowerCase();
const ELEVEN_KEY = (process.env.ELEVENLABS_API_KEY || '').trim();
const ELEVEN_VOICE = (process.env.ELEVENLABS_VOICE_ID || '').trim();
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5'; // en düşük gecikme
const EDGE_VOICE = process.env.EDGE_TTS_VOICE || 'tr-TR-EmelNeural';
const EDGE_RATE = process.env.EDGE_TTS_RATE || '+10%';

const NATIVE_VOICE = process.env.MACOS_TTS_VOICE || 'Yelda';

function nativeSaySpeak(text) {
  return new Promise((resolve) => {
    const args = ['-v', NATIVE_VOICE, text];
    const sp = spawn('say', args);
    activePlayer = sp;
    sp.on('close', (code) => {
      activePlayer = null;
      resolve(code === 0);
    });
    sp.on('error', (err) => {
      console.warn('[tts:say] spawn error:', err.message);
      activePlayer = null;
      resolve(false);
    });
  });
}

function edgeSpeak(text) {
  return new Promise((resolve) => {
    const tmp = `/tmp/xjarvis-edge-${Date.now()}-${Math.floor(Math.random() * 1e6)}.mp3`;
    const gen = spawn('edge-tts', ['--voice', EDGE_VOICE, '--rate', EDGE_RATE, '--text', text, '--write-media', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errBuf = '';
    gen.stderr.on('data', (d) => { errBuf += d.toString(); });
    gen.on('error', () => resolve(false));
    gen.on('close', (code) => {
      if (code !== 0) {
        console.warn('[tts:edge] gen failed code=', code, errBuf.slice(0, 200));
        return resolve(false);
      }
      const player = spawn('afplay', [tmp]);
      activePlayer = player;
      player.on('close', () => { activePlayer = null; fs.unlink(tmp, () => {}); resolve(true); });
      player.on('error', () => { activePlayer = null; fs.unlink(tmp, () => {}); resolve(false); });
    });
  });
}

// Voicebox (local, free TTS — voicebox.sh). Runs on 127.0.0.1:17493.
const VOICEBOX_HOST = process.env.VOICEBOX_HOST || '127.0.0.1';
const VOICEBOX_PORT = parseInt(process.env.VOICEBOX_PORT || '17493', 10);
const VOICEBOX_PROFILE = (process.env.VOICEBOX_PROFILE_ID || '').trim();
const VOICEBOX_LANG = process.env.VOICEBOX_LANGUAGE || 'tr';
const VOICEBOX_CLIENT = process.env.VOICEBOX_CLIENT_ID || 'xjarvis';

let activePlayer = null;

function elevenSpeak(text) {
  return new Promise((resolve) => {
    if (!ELEVEN_KEY || !ELEVEN_VOICE) return resolve(false);
    const payload = JSON.stringify({
      text,
      model_id: ELEVEN_MODEL,
      voice_settings: { stability: 0.4, similarity_boost: 0.85 },
    });
    const req = https.request({
      method: 'POST',
      host: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${encodeURIComponent(ELEVEN_VOICE)}/stream?output_format=mp3_44100_128`,
      headers: {
        'xi-api-key': ELEVEN_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60_000,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        console.warn('[tts:eleven] status', res.statusCode);
        return resolve(false);
      }
      const tmp = `/tmp/xjarvis-tts-${Date.now()}-${Math.floor(Math.random() * 1e6)}.mp3`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => {
        const player = spawn('afplay', [tmp]);
        activePlayer = player;
        player.on('close', () => {
          activePlayer = null;
          fs.unlink(tmp, () => {});
          resolve(true);
        });
      });
      out.on('error', () => { out.destroy(); resolve(false); });
    });
    req.on('error', (e) => { console.warn('[tts:eleven] req err', e.message); resolve(false); });
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(false); });
    req.write(payload); req.end();
  });
}

function stopElevenPlayback() {
  if (activePlayer) {
    try { activePlayer.kill('SIGTERM'); } catch {}
    activePlayer = null;
  }
}

const VOICEBOX_DATA_DIR = process.env.VOICEBOX_DATA_DIR
  || `${process.env.HOME}/Library/Application Support/sh.voicebox.app`;
const VOICEBOX_APP_PATH = process.env.VOICEBOX_APP_PATH || '/Applications/Voicebox.app';

function vbxReq(method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : '';
    const headers = body
      ? { 'Content-Type': 'application/json', 'X-Voicebox-Client-Id': VOICEBOX_CLIENT, 'Content-Length': Buffer.byteLength(payload) }
      : { 'X-Voicebox-Client-Id': VOICEBOX_CLIENT };
    const req = http.request({
      method, host: VOICEBOX_HOST, port: VOICEBOX_PORT, path, headers, timeout: 8000,
    }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(cs).toString();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ status: 0, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

let voiceboxRelaunchInFlight = null;
async function voiceboxEnsureUp() {
  const probe = await vbxReq('GET', '/health');
  if (probe.status === 200) return true;
  // Connection refused/timeout → server is down. Trigger relaunch (singleton).
  if (!voiceboxRelaunchInFlight) {
    voiceboxRelaunchInFlight = (async () => {
      console.warn('[tts:voicebox] server down — relaunching app');
      try { spawn('open', ['-a', VOICEBOX_APP_PATH], { detached: true, stdio: 'ignore' }).unref(); } catch {}
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const p = await vbxReq('GET', '/health');
        if (p.status === 200) {
          console.log('[tts:voicebox] server back up after', (i + 1) * 1.5, 's');
          return true;
        }
      }
      console.warn('[tts:voicebox] relaunch gave up after 60s');
      return false;
    })().finally(() => { voiceboxRelaunchInFlight = null; });
  }
  return voiceboxRelaunchInFlight;
}

function resolveAudioPath(ap) {
  if (!ap) return null;
  if (ap.startsWith('/')) return ap;
  return `${VOICEBOX_DATA_DIR}/${ap}`;
}

async function voiceboxSpeak(text) {
  if (!VOICEBOX_PROFILE) return false;

  // Health probe; if down, try to relaunch once before erroring out.
  const up = await voiceboxEnsureUp();
  if (!up) return false;

  const create = await vbxReq('POST', '/speak', {
    text, profile: VOICEBOX_PROFILE, language: VOICEBOX_LANG,
  });
  if (create.status !== 200 || !create.body || !create.body.id) {
    console.warn('[tts:voicebox] create failed', create.status, (create.raw || '').slice(0, 200));
    return false;
  }
  const gid = create.body.id;

  // Poll via /history?limit=5 (status endpoint is SSE — incompatible with simple HTTP).
  const deadline = Date.now() + 90_000;
  let final = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    const h = await vbxReq('GET', '/history?limit=5');
    if (h.status !== 200 || !h.body) continue;
    const item = (h.body.items || []).find((x) => x.id === gid);
    if (!item) continue;
    if (item.status === 'completed') { final = item; break; }
    if (item.status === 'failed') {
      console.warn('[tts:voicebox] generation failed:', item.error);
      return false;
    }
  }
  if (!final) { console.warn('[tts:voicebox] poll timeout'); return false; }

  const ap = resolveAudioPath(final.audio_path);
  if (!ap || !fs.existsSync(ap)) {
    console.warn('[tts:voicebox] audio file missing:', ap);
    return false;
  }
  return new Promise((resolve) => {
    const player = spawn('afplay', [ap]);
    activePlayer = player;
    player.on('close', () => { activePlayer = null; resolve(true); });
    player.on('error', () => { activePlayer = null; resolve(false); });
  });
}
// Sesli komuttan sonra cevabın seslendirileceği pencere. Agent tool döngüleri
// 30s'yi aşıp cevabı sessizce düşürebiliyordu; 120s güvenli sınır.
const VOICE_WINDOW_MS = Number(process.env.VOICE_TTS_WINDOW_MS) || 120_000;
const MIN_FLUSH_CHARS = 80;     // accumulate enough audio per chunk so playback is continuous, not choppy
const MAX_FRAGMENT_CHARS = 360; // cümle sınırı yoksa zorunlu kes
// Düşük gecikme: cümle tamamlandıkça hemen seslendir (RESPONSE_END'i bekleme).
const TTS_STREAM_SENTENCES = process.env.TTS_STREAM_SENTENCES !== '0';

const SENTENCE_END_RE = /([.!?…]+["')\]]?\s|[\n\r]{1,2})/g;

let buffer = '';
let pending = '';
let active = false;
let lastVoiceAt = 0;
let speakChain = Promise.resolve();
let chainCount = 0;
let bargedIn = false;   // session-level flag; reset on RESPONSE_START

function postVoice(path, body, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(
      { host: VOICE_HOST, port: VOICE_PORT, path, method: 'POST', headers, timeout: timeoutMs },
      (res) => {
        const cs = [];
        res.on('data', (c) => cs.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(cs).toString() || '{}')); }
          catch { resolve({}); }
        });
      },
    );
    req.on('error', () => resolve({}));
    req.on('timeout', () => { req.destroy(); resolve({}); });
    if (payload) req.write(payload);
    req.end();
  });
}

// Tüm konuşma akışını kapsayan TEK başla/bit pencere — chunk'lar arasındaki
// kısa boşlukta wake'in tetiklenmemesi için END'i debounce eder.
let activeSpeakers = 0;
let endDebounce = null;

let lastSpokenText = '';
function markSpeakStart(text) {
  activeSpeakers++;
  if (endDebounce) { clearTimeout(endDebounce); endDebounce = null; }
  if (typeof text === 'string' && text.trim()) {
    lastSpokenText = (lastSpokenText + ' ' + text).slice(-500).trim();
  }
  if (activeSpeakers === 1) {
    bus.emit(EVENT_TYPES.TTS_PLAYBACK_START, { backend: TTS_BACKEND, text: lastSpokenText }, 'system');
  }
}

function markSpeakEnd() {
  activeSpeakers = Math.max(0, activeSpeakers - 1);
  if (activeSpeakers === 0) {
    if (endDebounce) clearTimeout(endDebounce);
    // 1.5 sn debounce — bir sonraki chunk hemen gelirse START tekrar atılmaz
    endDebounce = setTimeout(() => {
      if (activeSpeakers === 0) {
        bus.emit(EVENT_TYPES.TTS_PLAYBACK_END, {}, 'system');
      }
      endDebounce = null;
    }, 1500);
  }
}

async function speak(text) {
  if (bargedIn) return;
  markSpeakStart(text);
  try {
    // Primary backend per env. Edge is the default (fast, free, neural TR).
    if (TTS_BACKEND === 'edge') {
      if (await edgeSpeak(text)) return;
      console.warn('[tts:fallback] edge→native_say');
    } else if (TTS_BACKEND === 'voicebox' && VOICEBOX_PROFILE) {
      if (await voiceboxSpeak(text)) return;
      console.warn('[tts:fallback] voicebox→edge');
      if (await edgeSpeak(text)) return;
      console.warn('[tts:fallback] edge→native_say');
    } else if (TTS_BACKEND === 'elevenlabs' && ELEVEN_KEY && ELEVEN_VOICE) {
      if (await elevenSpeak(text)) return;
      console.warn('[tts:fallback] elevenlabs→edge');
      if (await edgeSpeak(text)) return;
      console.warn('[tts:fallback] edge→native_say');
    }
    // Native macOS `say` fallback — always available, never silent failure.
    // Uses MACOS_TTS_VOICE (Yelda for TR) so the user always hears something.
    if (await nativeSaySpeak(text)) return;
    // Last-ditch: voice service /speak
    const r = await postVoice('/speak', { text });
    if (r && r.barged_in) {
      bargedIn = true;
      pending = '';
    }
  } finally {
    markSpeakEnd();
  }
}

let _lastEnq = '';
let _lastEnqAt = 0;
function enqueue(text) {
  const t = (text || '').trim();
  if (!t || bargedIn) return;
  // Çift-seslendirme koruması: aynı parça arka arkaya ~8s içinde tekrar gelirse
  // (cevap iki kez emit edilirse) ikincisini ATLA — "double söyleme" buggını keser.
  const now = Date.now();
  if (t === _lastEnq && now - _lastEnqAt < 8000) return;
  _lastEnq = t;
  _lastEnqAt = now;
  chainCount++;
  speakChain = speakChain.then(() => speak(t).catch(() => {}));
}

async function abortPlayback() {
  bargedIn = true;
  pending = '';
  stopElevenPlayback();
  try { await postVoice('/stop', {}, 5000); } catch { /* swallow */ }
}

function extractSpeakable(buf) {
  /**
   * Returns [speakable, remainder]. Splits at the LAST sentence terminator
   * found, so we say complete sentences. If no terminator and buf is too
   * long, force-flush at the last whitespace before MAX_FRAGMENT_CHARS.
   */
  let lastEnd = -1;
  let m;
  SENTENCE_END_RE.lastIndex = 0;
  while ((m = SENTENCE_END_RE.exec(buf)) !== null) {
    lastEnd = SENTENCE_END_RE.lastIndex;
  }
  if (lastEnd > 0) {
    const speakable = buf.slice(0, lastEnd);
    const remainder = buf.slice(lastEnd);
    if (speakable.trim().length < MIN_FLUSH_CHARS && remainder.length < MAX_FRAGMENT_CHARS) {
      return ['', buf];
    }
    return [speakable, remainder];
  }
  if (buf.length >= MAX_FRAGMENT_CHARS) {
    const cut = buf.lastIndexOf(' ', MAX_FRAGMENT_CHARS);
    if (cut > MIN_FLUSH_CHARS) {
      return [buf.slice(0, cut), buf.slice(cut)];
    }
  }
  return ['', buf];
}

function attachTTSBridge() {
  bus.on(EVENT_TYPES.STT_FINAL, () => {
    lastVoiceAt = Date.now();
  });

  bus.on(EVENT_TYPES.RESPONSE_START, (envelope) => {
    buffer = '';
    pending = '';
    chainCount = 0;
    speakChain = Promise.resolve();
    bargedIn = false;
    // 'greeting' / 'system' kanalı her zaman aktif olsun (selamlama için)
    const ch = envelope?.payload?.channel;
    if (ch === 'greeting' || ch === 'system') {
      active = true;
    } else {
      active = Date.now() - lastVoiceAt < VOICE_WINDOW_MS;
    }
  });

  // Listening start with reason 'barge_in' → flush queue & stop playback
  bus.on(EVENT_TYPES.LISTENING_START, (envelope) => {
    if (envelope?.payload?.reason === 'barge_in') {
      abortPlayback().catch(() => {});
    }
  });

  bus.on(EVENT_TYPES.RESPONSE_CHUNK, (envelope) => {
    if (!active) return;
    const text = envelope?.payload?.text;
    if (typeof text !== 'string') return;
    buffer += text;
    // Cümle tamamlandıkça hemen seslendir (RESPONSE_END'i bekleme) → ilk kelime
    // çok daha erken duyulur. Parçalar speakChain ile sırayla çalınır.
    if (TTS_STREAM_SENTENCES) {
      let [speakable, remainder] = extractSpeakable(buffer);
      while (speakable) {
        const frag = speakable.trim();
        if (frag) enqueue(frag);
        buffer = remainder;
        [speakable, remainder] = extractSpeakable(buffer);
      }
    }
  });

  bus.on(EVENT_TYPES.RESPONSE_END, () => {
    if (!active) {
      buffer = ''; pending = ''; return;
    }
    const flush = buffer.trim();
    pending = '';
    buffer = '';
    active = false;
    if (flush) enqueue(flush);
  });
}

module.exports = { attachTTSBridge };
