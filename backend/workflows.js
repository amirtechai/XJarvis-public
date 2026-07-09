/**
 * Lightweight workflow engine (MVP).
 *
 * Bir workflow = JSON: { name, trigger, action }
 *   trigger: { type: "cron", spec: "HH:MM" }                       (günlük tek seferlik)
 *           | { type: "interval", minutes: N }                      (her N dakika)
 *           | { type: "manual" }                                    (sadece UI'dan tetik)
 *   action:  { type: "telegram", message: "..." }
 *           | { type: "agent_prompt", prompt: "..." }               (openjarvis_ask çağırır, sonucu Telegram'a)
 *           | { type: "shell", command: "..." }
 *
 * Bu hafif tasarım gerçek bir node editor (n8n) değil ama 80%'i karşılar:
 * "her sabah saat 7'de mailimi triage et", "her 4 saatte ekran durumumu özetle", vb.
 *
 * Storage: SQLite (~/.config/xjarvis/workflows.db)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec, spawn } = require('child_process');
const Database = (() => { try { return require('better-sqlite3'); } catch { return null; } })();
const { sendToAllowlist } = require('./telegram');

const DB_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'workflows.db');
let db = null;
let timer = null;
const lastRunAt = new Map(); // workflowId -> ISO timestamp

function ensureDb() {
  if (db) return db;
  if (!Database) return null;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trigger_json TEXT NOT NULL,
      action_json TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_run_at TEXT,
      last_status TEXT
    );
  `);
  return db;
}

function listWorkflows() {
  const d = ensureDb(); if (!d) return [];
  return d.prepare('SELECT * FROM workflows ORDER BY id DESC').all().map((w) => ({
    ...w,
    trigger: safeParse(w.trigger_json),
    action: safeParse(w.action_json),
    enabled: !!w.enabled,
  }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

function createWorkflow({ name, trigger, action, enabled = true }) {
  const d = ensureDb(); if (!d) throw new Error('sqlite unavailable');
  if (!name) throw new Error('name required');
  const r = d.prepare(
    'INSERT INTO workflows (name, trigger_json, action_json, enabled) VALUES (?, ?, ?, ?)'
  ).run(name, JSON.stringify(trigger || {}), JSON.stringify(action || {}), enabled ? 1 : 0);
  return d.prepare('SELECT * FROM workflows WHERE id=?').get(r.lastInsertRowid);
}

function updateWorkflow(id, patch) {
  const d = ensureDb(); if (!d) throw new Error('sqlite unavailable');
  const sets = []; const vals = [];
  if ('name' in patch) { sets.push('name=?'); vals.push(patch.name); }
  if ('trigger' in patch) { sets.push('trigger_json=?'); vals.push(JSON.stringify(patch.trigger)); }
  if ('action' in patch) { sets.push('action_json=?'); vals.push(JSON.stringify(patch.action)); }
  if ('enabled' in patch) { sets.push('enabled=?'); vals.push(patch.enabled ? 1 : 0); }
  if (!sets.length) return d.prepare('SELECT * FROM workflows WHERE id=?').get(id);
  vals.push(id);
  d.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  return d.prepare('SELECT * FROM workflows WHERE id=?').get(id);
}

function deleteWorkflow(id) {
  const d = ensureDb(); if (!d) return false;
  d.prepare('DELETE FROM workflows WHERE id=?').run(id);
  return true;
}

function runShell(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || stderr || '').slice(0, 2000) });
    });
  });
}

function runAgentPrompt(prompt) {
  return new Promise((resolve) => {
    const proc = spawn(process.env.PYTHON_BIN || 'python3', [
      path.join(__dirname, 'openjarvis_ask.py'), prompt,
    ], { env: { ...process.env, PYTHONPATH: process.env.OPENJARVIS_SRC || '' } });
    let buf = '';
    proc.stdout.on('data', (c) => { buf += c.toString(); });
    proc.on('close', () => {
      const tokens = [];
      buf.split('\n').forEach((line) => {
        try { const j = JSON.parse(line); if (j.t) tokens.push(j.t); } catch {}
      });
      resolve(tokens.join('').slice(0, 3500));
    });
    setTimeout(() => { try { proc.kill(); } catch {} resolve(buf.slice(0, 1000)); }, 90_000);
  });
}

async function execAction(action) {
  if (!action || !action.type) return { ok: false, error: 'no action' };
  if (action.type === 'telegram') {
    const r = await sendToAllowlist(String(action.message || ''));
    return { ok: r.ok, error: r.error };
  }
  if (action.type === 'shell') {
    return runShell(action.command || '');
  }
  if (action.type === 'agent_prompt') {
    const out = await runAgentPrompt(action.prompt || '');
    if (out) await sendToAllowlist(`🧠 ${out}`);
    return { ok: true, output: out.slice(0, 200) };
  }
  return { ok: false, error: `unknown action ${action.type}` };
}

async function runWorkflow(id) {
  const d = ensureDb(); if (!d) return { ok: false, error: 'sqlite unavailable' };
  const w = d.prepare('SELECT * FROM workflows WHERE id=?').get(id);
  if (!w) return { ok: false, error: 'not found' };
  const action = safeParse(w.action_json);
  const r = await execAction(action);
  d.prepare("UPDATE workflows SET last_run_at=datetime('now'), last_status=? WHERE id=?")
    .run(r.ok ? 'ok' : `err: ${(r.error || '').slice(0, 80)}`, id);
  lastRunAt.set(id, Date.now());
  return r;
}

function shouldFire(w) {
  const t = safeParse(w.trigger_json);
  if (!t || !t.type) return false;
  if (t.type === 'manual') return false;
  const last = lastRunAt.get(w.id) || 0;
  const now = new Date();
  if (t.type === 'cron') {
    if (!/^\d{2}:\d{2}$/.test(t.spec || '')) return false;
    const [hh, mm] = t.spec.split(':').map(Number);
    const cur = now.getHours() * 60 + now.getMinutes();
    if (cur !== hh * 60 + mm) return false;
    // Don't double-fire within the same minute
    return Date.now() - last > 90_000;
  }
  if (t.type === 'interval') {
    const minutes = Number(t.minutes) || 0;
    if (minutes < 1) return false;
    return Date.now() - last >= minutes * 60_000;
  }
  return false;
}

async function tick() {
  const d = ensureDb(); if (!d) return;
  const rows = d.prepare("SELECT * FROM workflows WHERE enabled=1").all();
  for (const w of rows) {
    if (!shouldFire(w)) continue;
    try { await runWorkflow(w.id); } catch (e) { console.warn('[workflows] err:', e.message); }
  }
}

function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick().catch(() => {}), 30_000);
  console.log('[workflows] watcher started (30s tick)');
}

function shouldHandle(url) { return url.startsWith('/api/workflows'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/api\/workflows\/(\d+)(\/run)?$/);
    if (req.method === 'GET' && url.pathname === '/api/workflows') {
      res.writeHead(200); res.end(JSON.stringify(listWorkflows())); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/workflows') {
      const body = JSON.parse((await readBody(req)) || '{}');
      res.writeHead(200); res.end(JSON.stringify(createWorkflow(body))); return;
    }
    if (m && req.method === 'PATCH') {
      const body = JSON.parse((await readBody(req)) || '{}');
      res.writeHead(200); res.end(JSON.stringify(updateWorkflow(Number(m[1]), body))); return;
    }
    if (m && req.method === 'DELETE') {
      res.writeHead(200); res.end(JSON.stringify({ ok: deleteWorkflow(Number(m[1])) })); return;
    }
    if (m && m[2] === '/run' && req.method === 'POST') {
      const r = await runWorkflow(Number(m[1]));
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { start, listWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, runWorkflow, shouldHandle, handleHttp };
