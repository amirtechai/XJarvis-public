/**
 * Web monitoring — kayıtlı URL'leri periyodik fetch eder, içerik diff +
 * LLM "anlamlı bir değişiklik mi?" filtresi ile bildirim atar.
 *
 *   POST /api/web-monitor      {url, label?, interval_min?, prompt_filter?}
 *   GET  /api/web-monitor      → liste
 *   DELETE /api/web-monitor/:id
 *   POST /api/web-monitor/:id/check  → manuel check
 *
 * Storage: SQLite ~/.config/xjarvis/web-monitor.db
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { sendToAllowlist } = require('./telegram');

const Database = (() => { try { return require('better-sqlite3'); } catch { return null; } })();
const DB_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'web-monitor.db');
let db = null;
let timer = null;

function ensureDb() {
  if (db) return db;
  if (!Database) return null;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      label TEXT,
      interval_min INTEGER DEFAULT 60,
      prompt_filter TEXT,
      last_hash TEXT,
      last_text TEXT,
      last_checked_at TEXT,
      enabled INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS web_monitor_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER,
      ts TEXT DEFAULT (datetime('now')),
      summary TEXT,
      meaningful INTEGER DEFAULT 0
    );
  `);
  return db;
}

function fetchUrl(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 30_000, headers: { 'User-Agent': 'XJarvis/1.0' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').slice(0, 200_000)));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(''); });
  });
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function callLLMJson(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.2, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-WebMonitor' },
      timeout: 30000,
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

async function checkMonitor(id, { force = false } = {}) {
  const d = ensureDb(); if (!d) return { ok: false };
  const m = d.prepare('SELECT * FROM web_monitors WHERE id=?').get(id);
  if (!m) return { ok: false, error: 'not found' };

  const html = await fetchUrl(m.url);
  if (!html) return { ok: false, error: 'fetch failed' };
  const text = htmlToText(html).slice(0, 6000);
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);

  if (!force && m.last_hash && m.last_hash === hash) {
    d.prepare(`UPDATE web_monitors SET last_checked_at=datetime('now') WHERE id=?`).run(id);
    return { ok: true, changed: false };
  }

  let meaningful = false; let summary = '(içerik değişti)';
  if (m.last_text) {
    const judgment = await callLLMJson([
      { role: 'system', content: `İki metin verildiğinde, ikincisi birincisine göre anlamlı bir DEĞİŞİKLİK içeriyor mu (sadece tarih/zaman/sayaç değil, içerik fark) onu sapta. ${m.prompt_filter ? `Kullanıcı filtresi: ${m.prompt_filter}` : ''} Cevap: {"meaningful": true|false, "summary": "<1-2 cümle TR özet>"}` },
      { role: 'user', content: `ÖNCE:\n${m.last_text.slice(0, 3000)}\n\nSONRA:\n${text.slice(0, 3000)}` },
    ]);
    if (judgment) {
      meaningful = !!judgment.meaningful;
      summary = judgment.summary || summary;
    }
  } else {
    summary = '(ilk yakalama, henüz baseline)';
  }

  d.prepare(`UPDATE web_monitors SET last_hash=?, last_text=?, last_checked_at=datetime('now') WHERE id=?`)
    .run(hash, text, id);
  d.prepare(`INSERT INTO web_monitor_changes (monitor_id, summary, meaningful) VALUES (?, ?, ?)`)
    .run(id, summary, meaningful ? 1 : 0);

  if (meaningful) {
    try {
      await sendToAllowlist(`🌐 <b>${m.label || m.url}</b> değişti:\n${summary}\n\n${m.url}`);
    } catch {}
  }
  return { ok: true, changed: true, meaningful, summary };
}

async function tick() {
  const d = ensureDb(); if (!d) return;
  const all = d.prepare('SELECT * FROM web_monitors WHERE enabled=1').all();
  const now = Date.now();
  for (const m of all) {
    const last = m.last_checked_at ? new Date(m.last_checked_at + 'Z').getTime() : 0;
    if (now - last < (m.interval_min || 60) * 60_000) continue;
    try { await checkMonitor(m.id); } catch (e) { console.warn('[web-monitor] err:', e.message); }
  }
}

function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick().catch(() => {}), 5 * 60_000);
  console.log('[web-monitor] watcher started (5min tick)');
}

function shouldHandle(url) { return url.startsWith('/api/web-monitor'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/api\/web-monitor\/(\d+)(\/check)?$/);
    if (req.method === 'GET' && url.pathname === '/api/web-monitor') {
      const d = ensureDb();
      const rows = d ? d.prepare('SELECT * FROM web_monitors ORDER BY id DESC').all() : [];
      res.writeHead(200); res.end(JSON.stringify(rows)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/web-monitor') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const d = ensureDb();
      const r = d.prepare('INSERT INTO web_monitors (url, label, interval_min, prompt_filter) VALUES (?, ?, ?, ?)')
        .run(body.url, body.label || '', body.interval_min || 60, body.prompt_filter || '');
      const created = d.prepare('SELECT * FROM web_monitors WHERE id=?').get(r.lastInsertRowid);
      res.writeHead(200); res.end(JSON.stringify(created)); return;
    }
    if (m && req.method === 'DELETE') {
      const d = ensureDb();
      d.prepare('DELETE FROM web_monitors WHERE id=?').run(Number(m[1]));
      res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
    }
    if (m && m[2] === '/check' && req.method === 'POST') {
      const r = await checkMonitor(Number(m[1]), { force: true });
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { start, checkMonitor, shouldHandle, handleHttp };
