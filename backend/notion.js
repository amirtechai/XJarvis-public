/**
 * Notion entegrasyon — read/write API.
 *
 *   GET  /api/notion/search?q=...                    → page/db ara
 *   GET  /api/notion/page/:id                        → page içerik
 *   POST /api/notion/page    {parent_id, title, content}  → yeni sayfa
 *   PATCH /api/notion/page/:id  {append}             → appende blok ekle
 *   GET  /api/notion/db/:id/query?filter=...         → database query (basit)
 *
 * NOTION_API_KEY env değişkenine internal integration token konur:
 *   https://www.notion.so/profile/integrations
 *   Sonra Notion'da ilgili sayfa/db'yi integration ile paylaş ("Connections").
 */
const https = require('https');

const NOTION_API = 'api.notion.com';
const NOTION_VERSION = '2022-06-28';

function notionRequest(method, pathStr, body) {
  return new Promise((resolve) => {
    const key = (process.env.NOTION_API_KEY || '').trim();
    if (!key) return resolve({ ok: false, error: 'NOTION_API_KEY not set' });
    const payload = body ? JSON.stringify(body) : '';
    const headers = {
      Authorization: `Bearer ${key}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({
      method, host: NOTION_API, path: pathStr, headers, timeout: 30_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          if (j.object === 'error' || res.statusCode >= 400) resolve({ ok: false, error: j.message || j.code, raw: j });
          else resolve({ ok: true, ...j });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function search(query) {
  return notionRequest('POST', '/v1/search', { query, page_size: 30 });
}

async function checkConnection() {
  const r = await notionRequest('GET', '/v1/users/me');
  if (!r.ok) return { ok: false, error: r.error || 'unauthorized' };
  return { ok: true, user: { id: r.id, name: r.name, type: r.type, bot: r.bot } };
}

async function listDatabases() {
  const r = await notionRequest('POST', '/v1/search', {
    filter: { property: 'object', value: 'database' },
    page_size: 50,
  });
  return r;
}

async function archivePage(pageId) {
  return notionRequest('PATCH', `/v1/pages/${pageId}`, { archived: true });
}

async function updatePageTitle(pageId, title) {
  return notionRequest('PATCH', `/v1/pages/${pageId}`, {
    properties: {
      title: { title: [{ text: { content: String(title || '').slice(0, 200) } }] },
    },
  });
}

async function getPage(id) {
  const meta = await notionRequest('GET', `/v1/pages/${id}`);
  const blocks = await notionRequest('GET', `/v1/blocks/${id}/children?page_size=100`);
  return { ok: meta.ok && blocks.ok, meta: meta.ok ? meta : null, blocks: blocks.ok ? blocks.results : [] };
}

function paragraphBlock(text) {
  return {
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: String(text || '').slice(0, 1900) } }] },
  };
}

async function createPage({ parent_id, title, content = '' }) {
  if (!parent_id || !title) return { ok: false, error: 'parent_id and title required' };
  const blocks = String(content).split('\n').filter((l) => l.trim()).map(paragraphBlock);
  return notionRequest('POST', '/v1/pages', {
    parent: parent_id.includes('-') ? { page_id: parent_id } : { database_id: parent_id },
    properties: parent_id.includes('database')
      ? { Name: { title: [{ text: { content: title } }] } }
      : { title: { title: [{ text: { content: title } }] } },
    children: blocks.slice(0, 50),
  });
}

async function appendBlocks(pageId, content) {
  if (!pageId || !content) return { ok: false, error: 'pageId/content required' };
  const blocks = String(content).split('\n').filter((l) => l.trim()).map(paragraphBlock);
  return notionRequest('PATCH', `/v1/blocks/${pageId}/children`, { children: blocks.slice(0, 50) });
}

async function queryDb(dbId, body = {}) {
  return notionRequest('POST', `/v1/databases/${dbId}/query`, { ...body, page_size: 50 });
}

function shouldHandle(url) { return url.startsWith('/api/notion'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/notion/connection') {
      const r = await checkConnection();
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/notion/databases') {
      const r = await listDatabases();
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/notion/search') {
      const r = await search(url.searchParams.get('q') || '');
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    const pageMatch = url.pathname.match(/^\/api\/notion\/page\/([\w-]+)$/);
    if (pageMatch && req.method === 'GET') {
      const r = await getPage(pageMatch[1]);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (pageMatch && req.method === 'PATCH') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (body.title) {
        const r = await updatePageTitle(pageMatch[1], body.title);
        if (!r.ok) { res.writeHead(400); res.end(JSON.stringify(r)); return; }
      }
      if (body.append) {
        const r = await appendBlocks(pageMatch[1], body.append);
        res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
      }
      res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
    }
    if (pageMatch && req.method === 'DELETE') {
      const r = await archivePage(pageMatch[1]);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/notion/page') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await createPage(body);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    const dbMatch = url.pathname.match(/^\/api\/notion\/db\/([\w-]+)\/query$/);
    if (dbMatch && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await queryDb(dbMatch[1], body);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { search, getPage, createPage, appendBlocks, queryDb, archivePage, updatePageTitle, listDatabases, checkConnection, shouldHandle, handleHttp };
