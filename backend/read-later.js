/**
 * Read-it-later — URL paylaş → fetch → readability extract → LLM özet → KnowledgeStore.
 *
 *   POST /api/read-later {url, tags?}    → fetch + summarize + store
 *   GET  /api/read-later                 → list (recent)
 *   POST /api/read-later/:id/expand      → tam metin getir
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

const Database = (() => { try { return require('better-sqlite3'); } catch { return null; } })();
const DB_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'read-later.db');
let db = null;

function ensureDb() {
  if (db) return db;
  if (!Database) return null;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      author TEXT,
      summary TEXT,
      key_points TEXT,
      tags TEXT,
      content_text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function fetchUrl(url, ms = 30_000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: ms, headers: { 'User-Agent': 'Mozilla/5.0 XJarvis/1.0' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').slice(0, 500_000)));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(''); });
  });
}

function extractReadable(html) {
  // Very lightweight readability: try <article> first, fall back to body.
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  const main = articleMatch ? articleMatch[0] : html;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 200) : '';
  const text = main
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, text: text.slice(0, 12000) };
}

function callLLMJson(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.3, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-ReadLater' },
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

const SYS = `Verilen makaleyi Türkçe 4-6 cümlede özetle ve 4-6 maddelik "key_points" listesi çıkar. Çıktı:
{"summary": "...", "key_points": ["..."]}`;

async function importToKnowledgeStore(article) {
  return new Promise((resolve) => {
    const args = JSON.stringify([{
      doc_id: `read-later:${article.url}`,
      content: `${article.summary}\n\nKey points:\n${article.key_points.join('\n')}`,
      source: 'read_later',
      doc_type: 'article',
      title: article.title,
      url: article.url,
      timestamp: new Date().toISOString(),
      metadata: { tags: article.tags || [] },
    }]);
    const proc = spawn(process.env.PYTHON_BIN || 'python3', [
      path.join(__dirname, 'sync-knowledge.py'), 'import',
    ], { env: { ...process.env, PYTHONPATH: process.env.OPENJARVIS_SRC || '' } });
    proc.stdin.write(args); proc.stdin.end();
    let out = '';
    let resolved = false;
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('close', () => {
      if (!resolved) {
        resolved = true;
        try { resolve(JSON.parse(out || '{}')); } catch { resolve({ ok: false }); }
      }
    });
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { proc.kill(); } catch {}
        resolve({ ok: false });
      }
    }, 15000);
    proc.on('close', () => { clearTimeout(timer); });
  });
}

async function addArticle(url, tags = []) {
  const d = ensureDb();
  if (!d) return { ok: false, error: 'sqlite unavailable' };
  if (!url) return { ok: false, error: 'url required' };

  const html = await fetchUrl(url);
  if (!html) return { ok: false, error: 'fetch failed' };
  const { title, text } = extractReadable(html);
  if (!text || text.length < 200) return { ok: false, error: 'extract too short' };

  const llm = await callLLMJson([
    { role: 'system', content: SYS },
    { role: 'user', content: `Başlık: ${title}\n\nMetin:\n${text}` },
  ]);
  if (!llm) return { ok: false, error: 'llm_failed' };

  d.prepare(`INSERT OR REPLACE INTO articles (url, title, author, summary, key_points, tags, content_text)
             VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(url, title, '', llm.summary || '', JSON.stringify(llm.key_points || []), JSON.stringify(tags), text);

  const article = d.prepare('SELECT * FROM articles WHERE url=?').get(url);
  await importToKnowledgeStore({ ...article, key_points: llm.key_points || [], tags });
  return { ok: true, article: { ...article, key_points: llm.key_points || [] } };
}

function listArticles(limit = 50) {
  const d = ensureDb(); if (!d) return [];
  const rows = d.prepare('SELECT id, url, title, summary, key_points, tags, created_at FROM articles ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map((r) => ({ ...r, key_points: safeParse(r.key_points), tags: safeParse(r.tags) }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return []; } }

function shouldHandle(url) { return url.startsWith('/api/read-later'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/read-later') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await addArticle(body.url, body.tags || []);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/read-later') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      res.writeHead(200); res.end(JSON.stringify(listArticles(limit))); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { addArticle, listArticles, shouldHandle, handleHttp };
