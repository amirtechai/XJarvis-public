/**
 * Pattern detection — haftalık ve aylık LLM destekli pattern çıkarımı.
 *
 * Pazar gecesi 23:45'te, son 7 ve 30 günün connector verisini ve episodik
 * özetleri LLM'e verir, "tekrarlayan örüntüler" + "anomaliler" çıkarır.
 *
 * Output:
 *   • patterns table: {ts, window_days, patterns, anomalies, model}
 *   • Telegram'a kısa özet
 *   • profile.learned_facts'e nadiren yeni gerçek ekleme (örn "Çarşamba uykusuz")
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const Database = (() => { try { return require('better-sqlite3'); } catch { return null; } })();
const DB_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'patterns.db');
let db = null;
let timer = null;

function ensureDb() {
  if (db) return db;
  if (!Database) return null;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS detected_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT DEFAULT (datetime('now')),
      window_days INTEGER,
      patterns_json TEXT,
      anomalies_json TEXT,
      model TEXT
    );
  `);
  return db;
}

function callLLMJson(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.4, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-Patterns' },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const content = (j.choices?.[0]?.message?.content || '{}').trim().replace(/^```\w*\n?|\n?```$/g, '');
          resolve({ data: JSON.parse(content), model: j.model });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.write(payload); req.end();
  });
}

const SYS = `Sen JARVIS'in pattern detection bileşenisin. Kullanıcının son N gününe ait episodik özetler ve connector data'sından TEKRARLAYAN örüntüleri ve ANOMALİLERİ çıkarırsın.

Kurallar:
- Spekülasyon yapma; veriyle desteklemeli.
- Sadece anlamlı pattern'leri raporla — gürültüye değme.
- Türkçe ifade; "Pazartesi sabahları …" gibi somut.

Cevap şeması:
{
  "patterns": [{"observation": "...", "evidence": "...", "confidence": 0.0-1.0}],
  "anomalies": [{"observation": "...", "evidence": "...", "severity": "low|med|high"}],
  "facts_to_learn": ["<profile.learned_facts'e eklenmeye değer kısa cümleler — opsiyonel>"]
}`;

async function detectForWindow(days = 7) {
  // Pull last N daily summaries + a sample of recent chunks
  const em = require('./episodic-memory');
  const summaries = em.getRecent(days);
  if (!summaries.length) return { ok: false, error: 'no_episodic_data' };

  const corpus = summaries.map((s) => (
    `${s.date}: ${s.summary}\nKey facts: ${(s.key_facts || []).join(' / ')}`
  )).join('\n---\n');

  const result = await callLLMJson([
    { role: 'system', content: SYS },
    { role: 'user', content: `Son ${days} günün özetleri:\n\n${corpus}\n\nÖrüntüleri ve anomalileri çıkar.` },
  ]);
  if (!result?.data) return { ok: false, error: 'llm_failed' };

  const d = ensureDb();
  if (d) {
    d.prepare('INSERT INTO detected_patterns (window_days, patterns_json, anomalies_json, model) VALUES (?, ?, ?, ?)')
      .run(days, JSON.stringify(result.data.patterns || []), JSON.stringify(result.data.anomalies || []), result.model || '');
  }

  // Optionally promote facts_to_learn into profile
  if (Array.isArray(result.data.facts_to_learn) && result.data.facts_to_learn.length) {
    try {
      const userProfile = require('./user-profile');
      const profile = userProfile.load();
      const existing = new Set(profile.learned_facts.map((f) => f.fact?.toLowerCase()));
      for (const f of result.data.facts_to_learn) {
        if (f && !existing.has(String(f).toLowerCase())) {
          profile.learned_facts.push({ fact: f, source: 'pattern', ts: new Date().toISOString() });
        }
      }
      userProfile.save(profile);
    } catch {}
  }

  return { ok: true, ...result.data };
}

function listRecent(limit = 10) {
  const d = ensureDb(); if (!d) return [];
  const rows = d.prepare('SELECT * FROM detected_patterns ORDER BY ts DESC LIMIT ?').all(limit);
  return rows.map((r) => ({
    ts: r.ts, window_days: r.window_days,
    patterns: safeParse(r.patterns_json), anomalies: safeParse(r.anomalies_json),
    model: r.model,
  }));
}
function safeParse(s) { try { return JSON.parse(s); } catch { return []; } }

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function weeklyReport({ sendTelegram = true } = {}) {
  const r = await detectForWindow(7);
  // Veri yok → "Son 7 gün içinde hiçbir veri kaydedilmemiş" spam'i önlemek için sus.
  if (!r.ok) return r;
  if (!sendTelegram) return r;

  const hasPatterns = Array.isArray(r.patterns) && r.patterns.length > 0;
  const hasAnomalies = Array.isArray(r.anomalies) && r.anomalies.length > 0;
  // Sadece "veri yok / bilgi yok" türü anomalileri de filtrele.
  const meaningfulAnomalies = hasAnomalies
    ? r.anomalies.filter((a) => !/veri (kayd|yok|bulun)|hiç(bir)? veri|no data/i.test(String(a.observation || '')))
    : [];
  if (!hasPatterns && meaningfulAnomalies.length === 0) return r;

  const lines = [`📊 <b>Haftalık pattern raporu</b>`];
  if (hasPatterns) {
    lines.push('\n<b>Tekrarlayanlar:</b>');
    for (const p of r.patterns.slice(0, 6)) {
      lines.push(`  • ${escapeHtml(p.observation)} (güven %${Math.round((p.confidence || 0.5) * 100)})`);
    }
  }
  if (meaningfulAnomalies.length) {
    lines.push('\n<b>Anomaliler:</b>');
    for (const a of meaningfulAnomalies.slice(0, 4)) {
      lines.push(`  ⚠️ ${escapeHtml(a.observation)} [${a.severity || 'med'}]`);
    }
  }
  try {
    const { sendToAllowlist } = require('./telegram');
    await sendToAllowlist(lines.join('\n'));
  } catch {}
  return r;
}

// Aynı gün ikinci kez gönderme — Pazar 23:45+ penceresinde tick() dakikada bir
// çalıştığı için idempotency olmadan 15 mesaj spam atıyordu.
let lastWeeklyReportDate = null;
async function tick() {
  const now = new Date();
  if (now.getDay() !== 0 || now.getHours() !== 23 || now.getMinutes() < 45) return;
  const today = now.toISOString().slice(0, 10);
  if (lastWeeklyReportDate === today) return;
  lastWeeklyReportDate = today;
  await weeklyReport({ sendTelegram: true }).catch(() => {});
}

function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick().catch(() => {}), 60_000);
  console.log('[patterns] weekly watcher started (Sunday 23:45)');
}

function shouldHandle(url) { return url.startsWith('/api/patterns'); }
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/patterns/recent') {
      const limit = parseInt(url.searchParams.get('limit') || '10', 10);
      res.writeHead(200); res.end(JSON.stringify(listRecent(limit))); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/patterns/run') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { days = 7, send_telegram = false } = JSON.parse(body || '{}');
          const r = days >= 28 ? await detectForWindow(days) : await weeklyReport({ sendTelegram: send_telegram });
          res.writeHead(200); res.end(JSON.stringify(r));
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { start, detectForWindow, weeklyReport, listRecent, shouldHandle, handleHttp };
