/**
 * Episodik bellek — her gece 23:30'da o günün makro özetini üretir.
 *
 * Girdi: KnowledgeStore'da o gün eklenen chunks (mail, telegram, takvim,
 * granola), heartbeat log, agent etkileşim logu.
 * Çıktı: 3-5 cümle Türkçe özet + key facts list, daily_summaries tablosuna.
 *
 * Heartbeat ve agent context'ine son 3 gün özetlenir → sistem "dün ne
 * konuştuğumuzu hatırlar" hâline gelir (RAG'dan farklı; RAG kelime eşleşmesine
 * dayanır, episodik bellek anlatı katmanı).
 *
 * Storage: SQLite (~/.config/xjarvis/episodic.db)
 *   daily_summaries(date PRIMARY KEY, summary TEXT, key_facts JSON,
 *                   chunks_count INTEGER, generated_at TEXT, model TEXT)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const Database = (() => { try { return require('better-sqlite3'); } catch { return null; } })();
const DB_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'episodic.db');
let db = null;
let timer = null;

function ensureDb() {
  if (db) return db;
  if (!Database) return null;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_summaries (
      date TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      key_facts TEXT NOT NULL DEFAULT '[]',
      chunks_count INTEGER DEFAULT 0,
      generated_at TEXT DEFAULT (datetime('now')),
      model TEXT
    );
  `);
  return db;
}

function fetchChunksForDate(dateStr) {
  // dateStr = "YYYY-MM-DD"
  return new Promise((resolve) => {
    const py = process.env.PYTHON_BIN || 'python3';
    const helperArgs = JSON.stringify({ date: dateStr, limit: 200 });
    const proc = spawn(py, ['-c', `
import json, sqlite3, sys
from pathlib import Path
db = Path.home() / ".openjarvis" / "knowledge.db"
if not db.exists(): print("[]"); sys.exit(0)
args = json.loads('${helperArgs.replace(/'/g, "\\'")}')
date = args["date"]
limit = args["limit"]
conn = sqlite3.connect(str(db))
conn.row_factory = sqlite3.Row
rows = conn.execute("""
  SELECT source, doc_type, title, author, content, timestamp
  FROM knowledge_chunks
  WHERE timestamp LIKE ? || '%'
  ORDER BY timestamp DESC
  LIMIT ?
""", (date, limit)).fetchall()
out = [{
  "source": r["source"], "doc_type": r["doc_type"],
  "title": r["title"], "author": r["author"],
  "content": r["content"][:300], "timestamp": r["timestamp"],
} for r in rows]
print(json.dumps(out, ensure_ascii=False))
`]);
    let out = '';
    let resolved = false;
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('close', () => {
      if (!resolved) {
        resolved = true;
        try { resolve(JSON.parse(out || '[]')); } catch { resolve([]); }
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { proc.kill(); } catch {}
        resolve([]);
      }
    }, 15_000);
  });
}

function callLLMJson(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.4, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-EpisodicMemory' },
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

const SYS = `Sen JARVIS'in episodik bellek bileşenisin. Kullanıcının bir gününe ait tüm connector kayıtlarını okur, 3-5 cümlelik anlatısal Türkçe özet + maddeli "key_facts" listesi döndürürsün.

Kurallar:
- Spekülasyon yapma; sadece veriden çıkar.
- Tekrar eden bildirimleri (newsletter, Apple Mail otomatik) yok say.
- Önemli kişileri (gönderen/katılımcı) ve konuları öne çıkar.
- Türkçe, doğal akıcı dil. Asla bullet point'in özeti olarak yazma; "Bugün …" diye başla.
- key_facts: max 8 kısa madde (örn "Ahmet ile öğleden sonra meeting", "Calendar'da yarın için 3 yeni event").

Cevabın tam olarak şu JSON şemasında olsun:
{"summary": "<3-5 cümle anlatı>", "key_facts": ["<madde>", ...]}`;

async function generateSummaryForDate(dateStr, { force = false } = {}) {
  const d = ensureDb(); if (!d) return { ok: false, error: 'sqlite unavailable' };
  if (!force) {
    const existing = d.prepare('SELECT * FROM daily_summaries WHERE date=?').get(dateStr);
    if (existing) return { ok: true, summary: existing, regenerated: false };
  }

  const chunks = await fetchChunksForDate(dateStr);
  if (!chunks.length) {
    const empty = { summary: 'Bu gün için kaydedilmiş veri yok.', key_facts: [] };
    d.prepare('INSERT OR REPLACE INTO daily_summaries (date, summary, key_facts, chunks_count, generated_at, model) VALUES (?, ?, ?, ?, datetime(\'now\'), ?)').run(dateStr, empty.summary, '[]', 0, 'none');
    return { ok: true, summary: { date: dateStr, ...empty, chunks_count: 0 } };
  }

  const compact = chunks.slice(0, 80).map((c, i) => (
    `${i + 1}. [${c.source}/${c.doc_type}] ${c.title || '(no title)'} — ${c.author || ''}: ${c.content?.slice(0, 200)}`
  )).join('\n');

  const result = await callLLMJson([
    { role: 'system', content: SYS },
    { role: 'user', content: `Tarih: ${dateStr}\n\nO günün kayıtları (${chunks.length} chunk):\n${compact}\n\nÖzetle.` },
  ]);

  if (!result?.data?.summary) return { ok: false, error: 'llm_failed' };
  const facts = JSON.stringify(result.data.key_facts || []);

  d.prepare('INSERT OR REPLACE INTO daily_summaries (date, summary, key_facts, chunks_count, generated_at, model) VALUES (?, ?, ?, ?, datetime(\'now\'), ?)')
    .run(dateStr, result.data.summary, facts, chunks.length, result.model || 'unknown');

  return {
    ok: true, summary: {
      date: dateStr, summary: result.data.summary,
      key_facts: result.data.key_facts, chunks_count: chunks.length,
    },
  };
}

function getRecent(days = 3) {
  const d = ensureDb(); if (!d) return [];
  const rows = d.prepare(`SELECT * FROM daily_summaries ORDER BY date DESC LIMIT ?`).all(days);
  return rows.map((r) => ({ ...r, key_facts: safeParse(r.key_facts) }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return []; } }

function getRange(fromIso, toIso) {
  const d = ensureDb(); if (!d) return [];
  const rows = d.prepare('SELECT * FROM daily_summaries WHERE date BETWEEN ? AND ? ORDER BY date DESC').all(fromIso, toIso);
  return rows.map((r) => ({ ...r, key_facts: safeParse(r.key_facts) }));
}

function isoYesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function nightlyTick() {
  const now = new Date();
  if (now.getHours() !== 23 || now.getMinutes() < 30) return;
  const today = now.toISOString().slice(0, 10);
  // Generate today's summary at 23:30
  await generateSummaryForDate(today, { force: false }).catch(() => {});
}

function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => nightlyTick().catch(() => {}), 60_000);
  console.log('[memory] episodic watcher started (nightly 23:30)');
}

function shouldHandle(url) { return url.startsWith('/api/memory'); }
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/memory/recent') {
      const days = parseInt(url.searchParams.get('days') || '3', 10);
      res.writeHead(200); res.end(JSON.stringify(getRecent(days))); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/memory/range') {
      const from = url.searchParams.get('from') || '1970-01-01';
      const to = url.searchParams.get('to') || '2099-12-31';
      res.writeHead(200); res.end(JSON.stringify(getRange(from, to))); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/memory/regenerate') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { date } = JSON.parse(body || '{}');
          const target = date || isoYesterday();
          const r = await generateSummaryForDate(target, { force: true });
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

module.exports = { start, generateSummaryForDate, getRecent, getRange, shouldHandle, handleHttp };
