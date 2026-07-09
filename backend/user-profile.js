/**
 * Öğrenen kullanıcı profili — XJarvis kullanıcıyı tanıdıkça profile yazar.
 *
 * Profil JSON'da: ~/.config/xjarvis/user-profile.json
 * Yapı:
 * {
 *   "language": "tr",
 *   "name": "...",
 *   "timezone": "Europe/Istanbul",
 *   "writing_style": "kısa, direkt, espirili",
 *   "working_hours": "09:00-19:00",
 *   "important_people": [{"name":"...", "relationship":"...", "context":"..."}],
 *   "ongoing_projects": [{"name":"...", "status":"...", "last_seen":"..."}],
 *   "preferences": {"food":[...], "music":[...], "..."},
 *   "dislikes": [...],
 *   "learned_facts": [{"fact":"...", "source":"convo|connector", "ts":"..."}]
 * }
 *
 * Heartbeat ve agent system prompt'una "BU KULLANICI HAKKINDA BİLGİLER:"
 * bölümü olarak inject edilir.
 *
 * /api/profile/learn — son agent etkileşim sonrası tetiklenir; LLM "bu
 *   konuşmadan kullanıcı hakkında öğrendiklerin?" → mevcut profille MERGE.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const PROFILE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'user-profile.json');

const DEFAULT_PROFILE = {
  language: 'tr',
  name: '',
  timezone: 'Europe/Istanbul',
  writing_style: '',
  working_hours: '',
  important_people: [],
  ongoing_projects: [],
  preferences: {},
  dislikes: [],
  learned_facts: [],
  updated_at: null,
};

function load() {
  try {
    if (fs.existsSync(PROFILE_PATH)) {
      return { ...DEFAULT_PROFILE, ...JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8')) };
    }
  } catch {}
  return { ...DEFAULT_PROFILE };
}

function save(profile) {
  fs.mkdirSync(path.dirname(PROFILE_PATH), { recursive: true });
  profile.updated_at = new Date().toISOString();
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
  return profile;
}

function callLLMJson(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.3, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-Profile' },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const content = (j.choices?.[0]?.message?.content || '{}').trim().replace(/^```\w*\n?|\n?```$/g, '');
          resolve(JSON.parse(content));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.write(payload); req.end();
  });
}

const LEARN_SYS = `Sen XJarvis'in "kullanıcı modeli" bileşenisin. Verilen konuşma transkriptinden, kullanıcı hakkında profile EKLENECEK YENİ bilgileri çıkar. ASLA tahmin etme; yalnızca açıkça söylenenleri/ima edilenleri al.

Kategoriler:
- name (eğer ifade ettiyse)
- writing_style (kısa/uzun, formal/casual, espirili/ciddi vb.)
- working_hours (saat aralığı)
- important_people (yeni kişi: ad, ilişki, context)
- ongoing_projects (yeni proje: ad, kısa açıklama)
- preferences (yemek, müzik, spor vb.)
- dislikes
- learned_facts (kategorilenemeyen ama önemli tek-cümle gerçekler — örn "diyabetli, şeker az tüketmeli")

Cevabın TAM olarak şu JSON şemasında olsun (her alan opsiyonel, BOŞSA dahil etme):
{
  "name": "...",
  "writing_style": "...",
  "working_hours": "...",
  "add_important_people": [{"name":"...","relationship":"...","context":"..."}],
  "add_ongoing_projects": [{"name":"...","status":"..."}],
  "add_preferences": {"food":["..."], "music":["..."]},
  "add_dislikes": ["..."],
  "add_learned_facts": ["..."]
}

Eğer hiçbir yeni bilgi çıkarılamıyorsa SADECE {} döndür.`;

function mergeUpdate(profile, update) {
  if (update.name && !profile.name) profile.name = update.name;
  if (update.writing_style) profile.writing_style = update.writing_style;
  if (update.working_hours) profile.working_hours = update.working_hours;
  if (Array.isArray(update.add_important_people)) {
    const existing = new Set(profile.important_people.map((p) => p.name?.toLowerCase()));
    for (const p of update.add_important_people) {
      if (p?.name && !existing.has(p.name.toLowerCase())) profile.important_people.push(p);
    }
  }
  if (Array.isArray(update.add_ongoing_projects)) {
    const existing = new Set(profile.ongoing_projects.map((p) => p.name?.toLowerCase()));
    for (const p of update.add_ongoing_projects) {
      if (p?.name && !existing.has(p.name.toLowerCase())) profile.ongoing_projects.push({ ...p, last_seen: new Date().toISOString() });
    }
  }
  if (update.add_preferences) {
    for (const [cat, items] of Object.entries(update.add_preferences)) {
      if (!Array.isArray(items)) continue;
      profile.preferences[cat] = profile.preferences[cat] || [];
      const existing = new Set(profile.preferences[cat].map((s) => String(s).toLowerCase()));
      for (const it of items) {
        if (it && !existing.has(String(it).toLowerCase())) profile.preferences[cat].push(it);
      }
    }
  }
  if (Array.isArray(update.add_dislikes)) {
    const existing = new Set(profile.dislikes.map((s) => String(s).toLowerCase()));
    for (const d of update.add_dislikes) {
      if (d && !existing.has(String(d).toLowerCase())) profile.dislikes.push(d);
    }
  }
  if (Array.isArray(update.add_learned_facts)) {
    const existing = new Set(profile.learned_facts.map((f) => f.fact?.toLowerCase()));
    for (const f of update.add_learned_facts) {
      if (f && !existing.has(String(f).toLowerCase())) {
        profile.learned_facts.push({ fact: f, source: 'convo', ts: new Date().toISOString() });
      }
    }
  }
  // Cap fact list at 200 entries (sliding window)
  if (profile.learned_facts.length > 200) {
    profile.learned_facts = profile.learned_facts.slice(-200);
  }
  return profile;
}

async function learnFromTranscript(transcript) {
  if (!transcript || transcript.length < 30) return { ok: false, error: 'too short' };
  const update = await callLLMJson([
    { role: 'system', content: LEARN_SYS },
    { role: 'user', content: `Konuşma transkripti:\n\n${transcript.slice(0, 6000)}` },
  ]);
  if (!update) return { ok: false, error: 'llm_failed' };
  const profile = load();
  const before = JSON.stringify(profile);
  const merged = mergeUpdate(profile, update);
  if (JSON.stringify(merged) === before) return { ok: true, changed: false };
  save(merged);
  return { ok: true, changed: true, update };
}

/** Compact profile snippet for system-prompt injection. */
function asPromptSnippet() {
  const p = load();
  const lines = ['## Kullanıcı profili (öğrenilmiş — bağlamda kullan)'];
  if (p.name) lines.push(`- İsim: ${p.name}`);
  if (p.writing_style) lines.push(`- Yazı stili: ${p.writing_style}`);
  if (p.working_hours) lines.push(`- Çalışma saatleri: ${p.working_hours}`);
  if (p.important_people?.length) {
    lines.push(`- Önemli kişiler: ${p.important_people.slice(0, 8).map((x) => `${x.name}${x.relationship ? ` (${x.relationship})` : ''}`).join(', ')}`);
  }
  if (p.ongoing_projects?.length) {
    lines.push(`- Aktif projeler: ${p.ongoing_projects.slice(0, 6).map((x) => x.name).join(', ')}`);
  }
  if (Object.keys(p.preferences || {}).length) {
    const pref = Object.entries(p.preferences).slice(0, 6)
      .map(([k, v]) => `${k}=${(Array.isArray(v) ? v : [v]).slice(0, 4).join('/')}`)
      .join('; ');
    lines.push(`- Tercihler: ${pref}`);
  }
  if (p.dislikes?.length) lines.push(`- Hoşlanmadıkları: ${p.dislikes.slice(0, 6).join(', ')}`);
  if (p.learned_facts?.length) {
    lines.push('- Öğrenilen gerçekler:');
    for (const f of p.learned_facts.slice(-10)) lines.push(`  • ${f.fact}`);
  }
  return lines.join('\n');
}

function shouldHandle(url) { return url.startsWith('/api/profile'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'GET' && req.url === '/api/profile') {
      res.writeHead(200); res.end(JSON.stringify(load())); return;
    }
    if (req.method === 'PUT' && req.url === '/api/profile') {
      const patch = JSON.parse((await readBody(req)) || '{}');
      const merged = save({ ...load(), ...patch });
      res.writeHead(200); res.end(JSON.stringify(merged)); return;
    }
    if (req.method === 'POST' && req.url === '/api/profile/learn') {
      const { transcript } = JSON.parse((await readBody(req)) || '{}');
      const r = await learnFromTranscript(transcript);
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'GET' && req.url === '/api/profile/snippet') {
      res.writeHead(200); res.end(JSON.stringify({ snippet: asPromptSnippet() })); return;
    }
    if (req.method === 'POST' && req.url === '/api/profile/reset') {
      save({ ...DEFAULT_PROFILE });
      res.writeHead(200); res.end(JSON.stringify(load())); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { load, save, learnFromTranscript, asPromptSnippet, shouldHandle, handleHttp };
