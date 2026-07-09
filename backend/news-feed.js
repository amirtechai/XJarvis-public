/**
 * Tailored daily news — kullanıcının profile'ından çıkarılan ilgi alanlarına
 * göre RSS / HackerNews / NewsRSS connector çıktılarını filtreler ve özetler.
 *
 *   GET  /api/news/today         → bugünkü filtrelenmiş özet
 *   POST /api/news/regenerate    → cache'i sil, yeniden üret
 *   POST /api/news/feeds {url}   → kullanıcı RSS feed ekler
 *   DELETE /api/news/feeds/:id   → feed sil
 *   GET  /api/news/feeds         → liste
 *
 * Default feed'ler: HackerNews top, BBC Türkçe, TechCrunch.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');

const Database = (() => { try { return require('better-sqlite3'); } catch { return null; } })();
const DB_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'news.db');
let db = null;

const DEFAULT_FEEDS = [
  { url: 'https://hnrss.org/frontpage', label: 'HackerNews' },
  { url: 'https://feeds.bbci.co.uk/turkce/rss.xml', label: 'BBC Türkçe' },
  { url: 'https://techcrunch.com/feed/', label: 'TechCrunch' },
];

function ensureDb() {
  if (db) return db;
  if (!Database) return null;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      label TEXT,
      enabled INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS news_cache (
      date TEXT PRIMARY KEY,
      summary TEXT,
      generated_at TEXT
    );
  `);
  // Seed defaults if empty
  const cnt = db.prepare('SELECT COUNT(*) as n FROM feeds').get().n;
  if (cnt === 0) {
    for (const f of DEFAULT_FEEDS) {
      db.prepare('INSERT OR IGNORE INTO feeds (url, label) VALUES (?, ?)').run(f.url, f.label);
    }
  }
  return db;
}

function fetchUrl(url, ms = 20_000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: ms, headers: { 'User-Agent': 'XJarvis/1.0' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(''); });
  });
}

function parseRss(xml) {
  // Minimal RSS/Atom parser — title + link + description per item.
  const items = [];
  const re = /<(item|entry)[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < 25) {
    const block = m[0];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const link = (block.match(/<link[^>]*?href=["']([^"']+)["']/i) || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const desc = (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] || '';
    const clean = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    items.push({ title: clean(title), link: clean(link), desc: clean(desc).slice(0, 600) });
  }
  return items;
}

function callLLMJson(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.4, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-News' },
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

function getFeeds() {
  const d = ensureDb(); if (!d) return [];
  return d.prepare('SELECT * FROM feeds WHERE enabled=1').all();
}
function addFeed(url, label) {
  const d = ensureDb(); if (!d) return null;
  d.prepare('INSERT OR IGNORE INTO feeds (url, label) VALUES (?, ?)').run(url, label || '');
  return d.prepare('SELECT * FROM feeds WHERE url=?').get(url);
}
function deleteFeed(id) {
  const d = ensureDb(); if (!d) return false;
  d.prepare('DELETE FROM feeds WHERE id=?').run(id); return true;
}

async function buildToday() {
  const d = ensureDb();
  const today = new Date().toISOString().slice(0, 10);
  const cached = d?.prepare('SELECT * FROM news_cache WHERE date=?').get(today);
  if (cached) return { date: today, summary: cached.summary, cached: true };

  const feeds = getFeeds();
  const allItems = [];
  for (const f of feeds) {
    try {
      const xml = await fetchUrl(f.url);
      if (!xml) continue;
      for (const it of parseRss(xml)) allItems.push({ ...it, source: f.label || f.url });
    } catch {}
  }
  if (!allItems.length) return { date: today, summary: 'Bugün için haber alınamadı.', cached: false };

  // Pull profile interests
  let interests = '';
  try {
    const userProfile = require('./user-profile');
    const p = userProfile.load();
    const bits = [];
    if (p.ongoing_projects?.length) bits.push('Aktif projeler: ' + p.ongoing_projects.map((x) => x.name).join(', '));
    if (Object.keys(p.preferences || {}).length) {
      bits.push('Tercihler: ' + Object.entries(p.preferences).slice(0, 5).map(([k, v]) => `${k}=${(v || []).slice(0, 3).join('/')}`).join('; '));
    }
    if (p.learned_facts?.length) bits.push('Öğrenilen: ' + p.learned_facts.slice(-5).map((f) => f.fact).join(' · '));
    interests = bits.join('\n');
  } catch {}

  const compact = allItems.slice(0, 60).map((it, i) => `${i + 1}. [${it.source}] ${it.title} — ${it.desc.slice(0, 120)}`).join('\n');

  const r = await callLLMJson([
    { role: 'system', content: `Sen XJarvis haber editörüsün. Aşağıdaki haber listesini kullanıcının profiline göre filtrele, ALAKALI olan 6-10 başlığı seç, Türkçe 1-2 cümlelik özetlerle düzenli bir günlük "kişisel haber bülteni" oluştur. Her başlığa kaynağı ekle.\n\nCevap: {"summary": "<HTML formatlı bülten metni>"}` },
    { role: 'user', content: `Kullanıcı profili:\n${interests || '(profil boş)'}\n\nAday haberler:\n${compact}\n\nKişisel günlük bülten oluştur.` },
  ]);
  const summary = r?.summary || '(LLM cevap vermedi)';

  if (d) d.prepare('INSERT OR REPLACE INTO news_cache (date, summary, generated_at) VALUES (?, ?, datetime(\'now\'))').run(today, summary);
  return { date: today, summary, cached: false, item_count: allItems.length };
}

function shouldHandle(url) { return url.startsWith('/api/news'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/news/today') {
      const r = await buildToday();
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/news/regenerate') {
      const d = ensureDb();
      if (d) d.prepare('DELETE FROM news_cache WHERE date=?').run(new Date().toISOString().slice(0, 10));
      const r = await buildToday();
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/news/feeds') {
      res.writeHead(200); res.end(JSON.stringify(getFeeds())); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/news/feeds') {
      const body = JSON.parse((await readBody(req)) || '{}');
      res.writeHead(200); res.end(JSON.stringify(addFeed(body.url, body.label))); return;
    }
    const m = url.pathname.match(/^\/api\/news\/feeds\/(\d+)$/);
    if (m && req.method === 'DELETE') {
      res.writeHead(200); res.end(JSON.stringify({ ok: deleteFeed(Number(m[1])) })); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { buildToday, getFeeds, addFeed, shouldHandle, handleHttp };
