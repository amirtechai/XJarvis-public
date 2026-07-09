/**
 * Persona presets — JARVIS / FRIDAY / Empathy / Türk Usta etc.
 *   GET  /api/persona/list           → builtin + custom presets
 *   GET  /api/persona/active         → currently active persona id
 *   POST /api/persona/activate {id}  → writes XJARVIS_PERSONA + voice settings to .env
 *
 * Activation effects:
 *   - XJARVIS_PERSONA → agent loop reads + injects style into system prompt
 *   - MACOS_TTS_VOICE / ELEVENLABS_VOICE_ID set per persona suggestion
 *   - voice service must be restarted for voice change to take effect
 */
const fs = require('fs');
const path = require('path');

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
function writeEnv(patch) {
  const env = readEnv();
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v == null) delete env[k];
    else env[k] = String(v);
  }
  fs.writeFileSync(ENV_PATH, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
}

const PERSONAS = [
  {
    id: 'jarvis-classic',
    label: 'JARVIS Classic',
    description: 'Tony Stark\'ın orijinal AI uşağı — kuru zekâ, İngiliz tonu, kibar ama net.',
    style_hint: 'British butler tone, dry wit, clinical precision. Use "sir" or "patron" sparingly. Anticipate needs. Never sycophantic.',
    voice: { mac: 'Daniel', eleven: 'JBFqnCBsd6RMkjVDRZzb' /* George */, lang: 'en' },
  },
  {
    id: 'friday',
    label: 'F.R.I.D.A.Y.',
    description: 'Daha sıcak, hafif Irlanda aksanlı, oyuncu ama görevi unutmaz.',
    style_hint: 'Warm Irish-tinged accent, playful but mission-focused. Quick quips. Female voice. "Boss" or "patron".',
    voice: { mac: 'Moira', eleven: 'EXAVITQu4vr4xnSDxMaL' /* Sarah */, lang: 'en' },
  },
  {
    id: 'turk-usta',
    label: 'Türk Usta',
    description: 'Tecrübeli Türk ustası — sade, doğrudan, fazla nezaket dolgusu yok.',
    style_hint: 'Tecrübeli Türk usta tonu. Sade, doğrudan, "patron" hitabıyla. Argo yok. Net ve emin konuş.',
    voice: { mac: 'Yelda', eleven: 'JBFqnCBsd6RMkjVDRZzb', lang: 'tr' },
  },
  {
    id: 'empath',
    label: 'Empati',
    description: 'Yumuşak ton, duygusal farkındalık, psikolojik destek modu.',
    style_hint: 'Soft tone. Acknowledge emotion before answering. Ask gentle follow-ups. Never clinical.',
    voice: { mac: 'Samantha', eleven: 'EXAVITQu4vr4xnSDxMaL', lang: 'en' },
  },
  {
    id: 'mission-control',
    label: 'Mission Control',
    description: 'NASA görev kontrol merkezi — kısa, sayısal, telsiz disiplini.',
    style_hint: 'NASA mission-control radio discipline. Short. Numerical. Acknowledge ("copy that"), report status, no flourish.',
    voice: { mac: 'Daniel', eleven: 'JBFqnCBsd6RMkjVDRZzb', lang: 'en' },
  },
  {
    id: 'sherlock',
    label: 'Sherlock',
    description: 'Holmes-vari deduktif, hızlı, hafif sabırsız.',
    style_hint: 'Deductive precision. Lead with conclusion, then reasoning if asked. Slight impatience with vague queries.',
    voice: { mac: 'Daniel', eleven: 'JBFqnCBsd6RMkjVDRZzb', lang: 'en' },
  },
];

function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on('data', (x) => c.push(x));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf-8')));
  });
}

function shouldHandle(url) { return url.startsWith('/api/persona'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/persona/list') {
      const env = readEnv();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, personas: PERSONAS, active: env.XJARVIS_PERSONA || 'jarvis-classic' }));
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/persona/active') {
      const env = readEnv();
      const id = env.XJARVIS_PERSONA || 'jarvis-classic';
      const p = PERSONAS.find((x) => x.id === id) || PERSONAS[0];
      res.writeHead(200); res.end(JSON.stringify({ ok: true, active: p }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/persona/activate') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const p = PERSONAS.find((x) => x.id === body.id);
      if (!p) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'unknown persona' })); return; }
      writeEnv({
        XJARVIS_PERSONA: p.id,
        XJARVIS_PERSONA_HINT: p.style_hint,
        MACOS_TTS_VOICE: p.voice.mac,
        ELEVENLABS_VOICE_ID: p.voice.eleven,
        XJARVIS_LANG: p.voice.lang,
      });
      // Update process.env so this run reflects too
      process.env.XJARVIS_PERSONA = p.id;
      process.env.XJARVIS_PERSONA_HINT = p.style_hint;
      process.env.MACOS_TTS_VOICE = p.voice.mac;
      process.env.ELEVENLABS_VOICE_ID = p.voice.eleven;
      process.env.XJARVIS_LANG = p.voice.lang;
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, active: p, restart_required: true }));
      return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle, PERSONAS };
