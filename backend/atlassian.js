/**
 * Atlassian Jira Cloud REST API entegrasyonu.
 *
 *   GET  /api/atlassian/me                              → kimlik doğrulama
 *   GET  /api/atlassian/projects                        → proje listesi
 *   GET  /api/atlassian/issues/search?jql=...&max=10    → JQL araması
 *   GET  /api/atlassian/issue/:key                      → issue detayı
 *   POST /api/atlassian/issue/create
 *        body: { project, summary, description, issueType }
 *   POST /api/atlassian/issue/:key/comment {body}
 *
 * Auth: Basic base64(EMAIL:API_TOKEN)
 *   .env: ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN, ATLASSIAN_CLOUD_URL
 */
const https = require('https');

function authHeader() {
  const email = process.env.ATLASSIAN_EMAIL;
  const tok   = process.env.ATLASSIAN_API_TOKEN;
  if (!email || !tok) return null;
  return 'Basic ' + Buffer.from(`${email}:${tok}`).toString('base64');
}

function api(method, path, body) {
  return new Promise((resolve) => {
    const auth = authHeader();
    if (!auth) return resolve({ status: 401, json: { error: 'ATLASSIAN credentials missing' } });
    const host = process.env.ATLASSIAN_CLOUD_URL;
    if (!host) return resolve({ status: 400, json: { error: 'ATLASSIAN_CLOUD_URL missing' } });
    const isJson = body && typeof body === 'object';
    const payload = isJson ? JSON.stringify(body) : '';
    const headers = { Authorization: auth, Accept: 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const req = https.request({ host, path, method, headers, timeout: 12_000 }, (res) => {
      const cs = []; res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const text = Buffer.concat(cs).toString();
        try { resolve({ status: res.statusCode, json: text ? JSON.parse(text) : {} }); }
        catch { resolve({ status: res.statusCode, json: { raw: text.slice(0, 400) } }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, json: { error: e.message } }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: { error: 'timeout' } }); });
    if (payload) req.write(payload);
    req.end();
  });
}

function readBody(req) { return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); }); }

function ok(res, d)  { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ...d })); }
function err(res, code, m) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: m })); }

async function meHandler(_req, res) {
  const r = await api('GET', '/rest/api/3/myself');
  if (r.status !== 200) return err(res, r.status, JSON.stringify(r.json));
  ok(res, { display_name: r.json.displayName, email: r.json.emailAddress, account_id: r.json.accountId });
}

async function projectsHandler(_req, res) {
  const r = await api('GET', '/rest/api/3/project/search');
  if (r.status !== 200) return err(res, r.status, JSON.stringify(r.json));
  ok(res, { count: (r.json.values || []).length, items: (r.json.values || []).map((p) => ({ key: p.key, name: p.name, id: p.id })) });
}

async function issuesSearch(req, res) {
  const u = new URL(req.url, 'http://x');
  const jql = u.searchParams.get('jql') || 'assignee=currentUser() AND statusCategory!=Done ORDER BY updated DESC';
  const max = Math.min(50, parseInt(u.searchParams.get('max') || '15', 10));
  const r = await api('POST', '/rest/api/3/search/jql', {
    jql, maxResults: max, fields: ['summary', 'status', 'priority', 'assignee', 'updated'],
  });
  if (r.status !== 200) return err(res, r.status, JSON.stringify(r.json));
  const items = (r.json.issues || []).map((i) => ({
    key: i.key, summary: i.fields.summary,
    status: i.fields.status?.name, priority: i.fields.priority?.name,
    assignee: i.fields.assignee?.displayName, updated: i.fields.updated,
  }));
  ok(res, { count: items.length, items });
}

async function issueGet(req, res, key) {
  const r = await api('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,status,priority,assignee,reporter,created,updated`);
  if (r.status !== 200) return err(res, r.status, JSON.stringify(r.json));
  const f = r.json.fields || {};
  // ADF descrip plain text'e indirgenir
  const desc = (() => {
    if (typeof f.description === 'string') return f.description;
    try {
      const collect = (n) => Array.isArray(n) ? n.map(collect).join(' ') : (n?.text || (n?.content ? collect(n.content) : ''));
      return collect(f.description?.content);
    } catch { return ''; }
  })();
  ok(res, {
    key: r.json.key, summary: f.summary, description: desc?.slice(0, 4000),
    status: f.status?.name, priority: f.priority?.name,
    assignee: f.assignee?.displayName, reporter: f.reporter?.displayName,
    created: f.created, updated: f.updated,
  });
}

async function issueCreate(req, res) {
  const body = JSON.parse((await readBody(req)) || '{}');
  if (!body.project || !body.summary) return err(res, 400, 'project + summary required');
  const payload = {
    fields: {
      project: { key: body.project },
      summary: body.summary,
      issuetype: { name: body.issueType || 'Task' },
      description: body.description ? {
        type: 'doc', version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: body.description }] }],
      } : undefined,
    },
  };
  const r = await api('POST', '/rest/api/3/issue', payload);
  if (r.status !== 201) return err(res, r.status, JSON.stringify(r.json));
  ok(res, { key: r.json.key, id: r.json.id, link: `https://${process.env.ATLASSIAN_CLOUD_URL}/browse/${r.json.key}` });
}

async function issueComment(req, res, key) {
  const body = JSON.parse((await readBody(req)) || '{}');
  if (!body.body) return err(res, 400, 'body required');
  const payload = {
    body: {
      type: 'doc', version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: body.body }] }],
    },
  };
  const r = await api('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, payload);
  if (r.status !== 201) return err(res, r.status, JSON.stringify(r.json));
  ok(res, { id: r.json.id });
}

function shouldHandle(url) { return url.startsWith('/api/atlassian/'); }

async function handleHttp(req, res) {
  const u = req.url;
  if (req.method === 'GET'  && u.startsWith('/api/atlassian/me'))             return meHandler(req, res);
  if (req.method === 'GET'  && u.startsWith('/api/atlassian/projects'))       return projectsHandler(req, res);
  if (req.method === 'GET'  && u.startsWith('/api/atlassian/issues/search'))  return issuesSearch(req, res);
  if (req.method === 'POST' && u.startsWith('/api/atlassian/issue/create'))   return issueCreate(req, res);
  // /api/atlassian/issue/:key
  // /api/atlassian/issue/:key/comment
  const m = u.match(/^\/api\/atlassian\/issue\/([A-Z0-9-]+)(\/comment)?(?:\?|$)/);
  if (m) {
    const key = m[1];
    if (m[2] && req.method === 'POST') return issueComment(req, res, key);
    if (req.method === 'GET')          return issueGet(req, res, key);
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
}

module.exports = { shouldHandle, handleHttp };
