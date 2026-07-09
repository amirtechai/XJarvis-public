/**
 * Long-term goals / OKR — kullanıcı hedef ekler, JARVIS haftalık check-in yapar.
 *
 * Storage: SQLite (~/.config/xjarvis/goals.db)
 *   goals(id, title, why, deadline, progress_pct, status, created_at, updated_at, signal_query)
 *   checkins(id, goal_id, ts, summary, progress_pct, llm_note)
 *
 * Heartbeat'e bağlı: heartbeat context'ine "active_goals" ekle, böylece LLM
 * proaktif kararlarında hedefleri dikkate alır.
 *
 * REST:
 *   GET  /api/goals          → list
 *   POST /api/goals          → {title, why, deadline, signal_query?} create
 *   PATCH /api/goals/:id     → update
 *   DELETE /api/goals/:id    → archive
 *   POST /api/goals/:id/checkin  → manual check-in (LLM özet)
 *   POST /api/goals/weekly-review → tüm aktif hedefler için topluca özet → Telegram
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = (() => {
  try { return require('better-sqlite3'); }
  catch { return null; }
})();
const https = require('https');
const { sendToAllowlist } = require('./telegram');

const DB_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'goals.db');
let db = null;

function ensureDb() {
  if (db) return db;
  if (!Database) {
    console.warn('[goals] better-sqlite3 not installed — goals disabled. npm install better-sqlite3');
    return null;
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      why TEXT,
      deadline TEXT,
      progress_pct INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      signal_query TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS goal_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      ts TEXT DEFAULT (datetime('now')),
      summary TEXT,
      progress_pct INTEGER,
      llm_note TEXT,
      FOREIGN KEY(goal_id) REFERENCES goals(id)
    );
  `);
  return db;
}

function listGoals(includeArchived = false) {
  const d = ensureDb(); if (!d) return [];
  const rows = includeArchived
    ? d.prepare('SELECT * FROM goals ORDER BY updated_at DESC').all()
    : d.prepare("SELECT * FROM goals WHERE status='active' ORDER BY updated_at DESC").all();
  for (const g of rows) {
    g.recent_checkins = d.prepare('SELECT * FROM goal_checkins WHERE goal_id=? ORDER BY ts DESC LIMIT 3').all(g.id);
  }
  return rows;
}

function createGoal({ title, why = '', deadline = null, signal_query = '' }) {
  const d = ensureDb(); if (!d) return null;
  if (!title) throw new Error('title required');
  const r = d.prepare(
    'INSERT INTO goals (title, why, deadline, signal_query) VALUES (?, ?, ?, ?)'
  ).run(title, why, deadline, signal_query);
  return d.prepare('SELECT * FROM goals WHERE id=?').get(r.lastInsertRowid);
}

function updateGoal(id, patch) {
  const d = ensureDb(); if (!d) return null;
  const cols = ['title', 'why', 'deadline', 'progress_pct', 'status', 'signal_query'];
  const sets = []; const vals = [];
  for (const c of cols) {
    if (c in patch) { sets.push(`${c}=?`); vals.push(patch[c]); }
  }
  if (!sets.length) return d.prepare('SELECT * FROM goals WHERE id=?').get(id);
  sets.push("updated_at=datetime('now')");
  vals.push(id);
  d.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  return d.prepare('SELECT * FROM goals WHERE id=?').get(id);
}

function archiveGoal(id) {
  const d = ensureDb(); if (!d) return false;
  d.prepare("UPDATE goals SET status='archived', updated_at=datetime('now') WHERE id=?").run(id);
  return true;
}

// Spawn a python helper to query KnowledgeStore for goal-related signals.
const { spawn } = require('child_process');
function searchSignals(query, sinceDays = 14) {
  return new Promise((resolve) => {
    if (!query) return resolve([]);
    const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
    const args = JSON.stringify({ query, since, top_k: 5 });
    const proc = spawn(process.env.PYTHON_BIN || 'python3', [
      path.join(__dirname, 'meeting-brief-search.py'), args,
    ], { env: { ...process.env, PYTHONPATH: process.env.OPENJARVIS_SRC || '' } });
    let out = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('close', () => { try { resolve(JSON.parse(out || '[]')); } catch { resolve([]); } });
    setTimeout(() => { try { proc.kill(); } catch {} resolve([]); }, 10_000);
  });
}

function callLLMJson(messages, { temperature = 0.3 } = {}) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-Goals' },
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

async function checkinGoal(id) {
  const d = ensureDb(); if (!d) return null;
  const goal = d.prepare('SELECT * FROM goals WHERE id=?').get(id);
  if (!goal) return null;

  const signals = await searchSignals(goal.signal_query || goal.title, 14);

  const sys = `Sen JARVIS'in hedef takip uzmanısın. Kullanıcının uzun vadeli hedefine son 14 günün connector verilerinden çıkardığın sinyalleri bakar, kısa bir Türkçe değerlendirme yazar ve yüzde olarak ilerleme tahmini verirsin. Cevabı şu JSON şemasında ver:
{
  "summary": "<2-3 cümle, ilerleme/durum>",
  "progress_pct": <0-100 tamsayı>,
  "next_action": "<bir sonraki somut adım>"
}`;
  const user = `Hedef: ${goal.title}
Neden: ${goal.why || '(belirtilmedi)'}
Deadline: ${goal.deadline || '(yok)'}
Mevcut ilerleme: ${goal.progress_pct}%

Son 14 günün ilgili sinyalleri (${signals.length} sonuç):
${signals.map((s, i) => `${i + 1}. [${s.source}] ${s.title}: ${s.snippet?.slice(0, 120)}`).join('\n') || '(sinyal bulunamadı)'}

Değerlendir.`;

  const decision = await callLLMJson([{ role: 'system', content: sys }, { role: 'user', content: user }]);
  if (!decision) return { goal, signals, error: 'LLM unavailable' };

  d.prepare('INSERT INTO goal_checkins (goal_id, summary, progress_pct, llm_note) VALUES (?, ?, ?, ?)')
    .run(id, decision.summary || '', decision.progress_pct ?? null, decision.next_action || '');
  if (typeof decision.progress_pct === 'number') {
    d.prepare("UPDATE goals SET progress_pct=?, updated_at=datetime('now') WHERE id=?").run(decision.progress_pct, id);
  }
  return { goal: d.prepare('SELECT * FROM goals WHERE id=?').get(id), decision, signals };
}

async function weeklyReview() {
  const goals = listGoals(false);
  if (!goals.length) return { ok: true, empty: true };

  const reviews = [];
  for (const g of goals) {
    const r = await checkinGoal(g.id).catch(() => null);
    if (r?.decision) reviews.push({ goal: g, ...r.decision });
  }

  if (!reviews.length) return { ok: true, empty: true };

  const lines = [`🎯 <b>Haftalık hedef özeti</b>`];
  for (const r of reviews) {
    const pct = typeof r.progress_pct === 'number' ? `${r.progress_pct}%` : '?';
    lines.push(`\n<b>${r.goal.title}</b> — ${pct}`);
    lines.push(`  ${r.summary}`);
    if (r.next_action) lines.push(`  → ${r.next_action}`);
  }
  const text = lines.join('\n');
  const sent = await sendToAllowlist(text);
  return { ok: sent.ok, error: sent.error, reviews: reviews.length, preview: text.slice(0, 240) };
}

function shouldHandle(url) { return url.startsWith('/api/goals'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/api\/goals\/(\d+)(\/checkin)?$/);
    if (req.method === 'GET' && url.pathname === '/api/goals') {
      res.writeHead(200); res.end(JSON.stringify(listGoals(url.searchParams.get('all') === '1'))); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/goals') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const g = createGoal(body);
      res.writeHead(200); res.end(JSON.stringify(g)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/goals/weekly-review') {
      const r = await weeklyReview();
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (m && req.method === 'PATCH') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const g = updateGoal(Number(m[1]), body);
      res.writeHead(200); res.end(JSON.stringify(g)); return;
    }
    if (m && req.method === 'DELETE') {
      archiveGoal(Number(m[1]));
      res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
    }
    if (m && m[2] === '/checkin' && req.method === 'POST') {
      const r = await checkinGoal(Number(m[1]));
      res.writeHead(200); res.end(JSON.stringify(r || { error: 'not found' })); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { listGoals, createGoal, updateGoal, archiveGoal, checkinGoal, weeklyReview, handleHttp, shouldHandle };
