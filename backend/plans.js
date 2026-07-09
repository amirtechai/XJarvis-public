/**
 * Long-horizon planning — kullanıcının uzun süreli bir hedefini agent'a verir,
 * agent çok-adımlı plan üretir, adımlar SQLite'a yazılır, heartbeat günde
 * bir kez "bugün hangi adımı yap" diye sırayı yürütür.
 *
 *   POST /api/plans           {goal, horizon_days?} → plan oluştur (LLM)
 *   GET  /api/plans                                  → liste
 *   PATCH /api/plans/:id      {status, progress_pct} → durumu güncelle
 *   POST /api/plans/:id/advance                      → bir sonraki adımı çalıştır
 *   DELETE /api/plans/:id                            → arşivle
 *
 * Şema:
 *   plans(id, goal, horizon_days, status, progress_pct, created_at, updated_at)
 *   plan_steps(id, plan_id, step_index, title, instructions, status,
 *              assigned_date, completed_at, output)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const Database = (() => { try { return require('better-sqlite3'); } catch { return null; } })();
const DB_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'plans.db');
let db = null;
let timer = null;

function ensureDb() {
  if (db) return db;
  if (!Database) return null;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal TEXT NOT NULL,
      horizon_days INTEGER DEFAULT 14,
      status TEXT DEFAULT 'active',
      progress_pct INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plan_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      instructions TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      assigned_date TEXT,
      completed_at TEXT,
      output TEXT,
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    );
  `);
  return db;
}

function callLLMJson(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.5, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-Plans' },
      timeout: 60000,
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

const PLANNER_SYS = `Sen XJarvis'in plancı bileşenisin. Kullanıcının uzun-vadeli bir hedefini alır, ufka (horizon_days) yayılmış SOMUT, GÜNLÜK aksiyonlara böler.

Kurallar:
- Her adım 30-90 dk arası, tek seansta tamamlanabilir nitelikte olsun.
- Adım sırası mantıklı: araştırma → karar → uygulama → doğrulama.
- Türkçe başlık + Türkçe instructions (agent'ın anlayacağı operatif talimat).
- Adım başına TEK ana eylem.
- Maks 12 adım. Tipik 5-8 adım yeter.

Cevap şeması:
{
  "title": "<plan başlık>",
  "summary": "<2 cümle plan özeti>",
  "steps": [
    {"title": "<kısa>", "instructions": "<agent için detaylı talimat — knowledge_search/web_search/browser_navigate gibi araçları nerede kullanabileceğine ipucu>"}
  ]
}`;

async function createPlan({ goal, horizon_days = 14 }) {
  const d = ensureDb(); if (!d) throw new Error('sqlite unavailable');
  if (!goal) throw new Error('goal required');
  const llm = await callLLMJson([
    { role: 'system', content: PLANNER_SYS },
    { role: 'user', content: `Hedef: ${goal}\nUfuk: ${horizon_days} gün\n\nPlanı çıkar.` },
  ]);
  if (!llm?.steps?.length) throw new Error('LLM plan üretemedi');

  const insertPlan = d.prepare('INSERT INTO plans (goal, horizon_days) VALUES (?, ?)').run(llm.title || goal, horizon_days);
  const planId = insertPlan.lastInsertRowid;

  const insertStep = d.prepare(`INSERT INTO plan_steps (plan_id, step_index, title, instructions, assigned_date) VALUES (?, ?, ?, ?, ?)`);
  const now = new Date();
  for (let i = 0; i < llm.steps.length; i++) {
    const s = llm.steps[i];
    const dt = new Date(now.getTime() + i * Math.max(1, Math.floor(horizon_days / llm.steps.length)) * 86400_000);
    insertStep.run(planId, i, s.title || '(untitled)', s.instructions || '', dt.toISOString().slice(0, 10));
  }
  return getPlan(planId);
}

function getPlan(id) {
  const d = ensureDb(); if (!d) return null;
  const plan = d.prepare('SELECT * FROM plans WHERE id=?').get(id);
  if (!plan) return null;
  plan.steps = d.prepare('SELECT * FROM plan_steps WHERE plan_id=? ORDER BY step_index ASC').all(id);
  return plan;
}

function listPlans(includeArchived = false) {
  const d = ensureDb(); if (!d) return [];
  const rows = includeArchived
    ? d.prepare('SELECT * FROM plans ORDER BY updated_at DESC').all()
    : d.prepare("SELECT * FROM plans WHERE status='active' ORDER BY updated_at DESC").all();
  return rows.map((p) => ({ ...p, steps: d.prepare('SELECT * FROM plan_steps WHERE plan_id=? ORDER BY step_index ASC').all(p.id) }));
}

function updatePlan(id, patch) {
  const d = ensureDb(); if (!d) return null;
  const sets = []; const vals = [];
  if ('status' in patch) { sets.push('status=?'); vals.push(patch.status); }
  if ('progress_pct' in patch) { sets.push('progress_pct=?'); vals.push(patch.progress_pct); }
  if (!sets.length) return getPlan(id);
  sets.push("updated_at=datetime('now')"); vals.push(id);
  d.prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  return getPlan(id);
}

function archivePlan(id) {
  const d = ensureDb(); if (!d) return false;
  d.prepare("UPDATE plans SET status='archived', updated_at=datetime('now') WHERE id=?").run(id);
  return true;
}

function runAgentPrompt(prompt) {
  return new Promise((resolve) => {
    const proc = spawn(process.env.PYTHON_BIN || 'python3', [
      path.join(__dirname, 'openjarvis_ask.py'), prompt,
    ], { env: { ...process.env, PYTHONPATH: process.env.OPENJARVIS_SRC || '' } });
    let buf = '';
    let resolved = false;
    proc.stdout.on('data', (c) => { buf += c.toString(); });
    proc.on('close', () => {
      if (!resolved) {
        resolved = true;
        const out = [];
        buf.split('\n').forEach((line) => { try { const j = JSON.parse(line); if (j.t) out.push(j.t); } catch {} });
        resolve(out.join('').slice(0, 4000));
      }
    });
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { proc.kill(); } catch {}
        const out = [];
        buf.split('\n').forEach((line) => { try { const j = JSON.parse(line); if (j.t) out.push(j.t); } catch {} });
        resolve(out.join('').slice(0, 4000));
      }
    }, 180_000);
    proc.on('close', () => { clearTimeout(timer); });
  });
}

async function advancePlan(id) {
  const d = ensureDb(); if (!d) return { ok: false, error: 'sqlite unavailable' };
  const plan = getPlan(id);
  if (!plan) return { ok: false, error: 'not found' };
  const next = plan.steps.find((s) => s.status === 'pending');
  if (!next) return { ok: true, done: true };

  d.prepare("UPDATE plan_steps SET status='running' WHERE id=?").run(next.id);

  const prompt = `Hedef: ${plan.goal}\n\nBu adımı yürüt:\n${next.title}\n\nTalimat:\n${next.instructions}\n\nGerekli araçları kullanarak adımı tamamla. Sonuca ulaştığında 1-2 cümleyle özetle.`;
  const output = await runAgentPrompt(prompt);

  d.prepare(`UPDATE plan_steps SET status='completed', completed_at=datetime('now'), output=? WHERE id=?`).run(output || '', next.id);
  // Update plan progress
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === 'completed').length + 1;
  const pct = Math.round((done / total) * 100);
  d.prepare(`UPDATE plans SET progress_pct=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(pct, pct >= 100 ? 'completed' : 'active', id);

  return { ok: true, step: next.title, output };
}

async function dailyTick() {
  // Once per day (we just check by skipping if a step ran in last 12h)
  const d = ensureDb(); if (!d) return;
  const now = new Date();
  if (now.getHours() !== 9 || now.getMinutes() < 30) return;
  const active = d.prepare("SELECT id FROM plans WHERE status='active'").all();
  for (const p of active) {
    try { await advancePlan(p.id); } catch (e) { console.warn('[plans] advance err:', e.message); }
  }
}

function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => dailyTick().catch(() => {}), 60_000);
  console.log('[plans] daily watcher started (09:30)');
}

function shouldHandle(url) { return url.startsWith('/api/plans'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/api\/plans\/(\d+)(\/advance)?$/);
    if (req.method === 'GET' && url.pathname === '/api/plans') {
      res.writeHead(200); res.end(JSON.stringify(listPlans(url.searchParams.get('all') === '1'))); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/plans') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await createPlan(body);
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (m && m[2] === '/advance' && req.method === 'POST') {
      const r = await advancePlan(Number(m[1]));
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (m && req.method === 'PATCH') {
      const body = JSON.parse((await readBody(req)) || '{}');
      res.writeHead(200); res.end(JSON.stringify(updatePlan(Number(m[1]), body))); return;
    }
    if (m && req.method === 'DELETE') {
      res.writeHead(200); res.end(JSON.stringify({ ok: archivePlan(Number(m[1])) })); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { start, createPlan, getPlan, listPlans, updatePlan, archivePlan, advancePlan, shouldHandle, handleHttp };
