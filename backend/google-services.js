/**
 * Google Workspace tool-belt — Gmail / Calendar / Tasks / Drive / People
 *
 *   GET  /api/google/gmail/list?q=&max=             → mail listesi (ID + snippet)
 *   GET  /api/google/gmail/get?id=ID                → tek mail (subject, from, body)
 *   POST /api/google/gmail/send {to, subject, body} → mail gönder
 *   POST /api/google/gmail/draft {to, subject, body}→ taslak oluştur
 *
 *   GET  /api/google/calendar/upcoming?max=         → ileri tarih event listesi
 *   POST /api/google/calendar/create {summary, start, end, attendees?}
 *
 *   GET  /api/google/tasks/list                     → todo listesi
 *   POST /api/google/tasks/add {title, notes?}      → todo ekle
 *
 *   GET  /api/google/drive/recent?max=              → son dosyalar
 *   GET  /api/google/people/search?q=NAME           → kişi → email lookup
 *
 * Tüm istekler GOOGLE_ACCESS_TOKEN kullanır; expired ise otomatik refresh.
 */
const https = require('https');
const { refreshToken, readEnv } = require('./google-oauth');

async function ensureToken() {
  const env = readEnv();
  const exp = parseInt(env.GOOGLE_TOKEN_EXPIRES_AT || '0', 10);
  if (env.GOOGLE_ACCESS_TOKEN && Date.now() < exp - 30_000) return env.GOOGLE_ACCESS_TOKEN;
  const r = await refreshToken();
  if (!r.ok) return null;
  return readEnv().GOOGLE_ACCESS_TOKEN;
}

function gApi(method, urlStr, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isJson = body && typeof body === 'object' && !Buffer.isBuffer(body);
    const payload = isJson ? JSON.stringify(body) : (body || '');
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (payload) {
      headers['Content-Type'] = isJson ? 'application/json' : 'message/rfc822';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request({
      host: u.host, path: u.pathname + u.search, method, headers, timeout: 15_000,
    }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const text = Buffer.concat(cs).toString();
        try { resolve({ status: res.statusCode, json: JSON.parse(text || '{}') }); }
        catch { resolve({ status: res.statusCode, json: { raw: text } }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}

function err(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: msg }));
}

function ok(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, ...data }));
}

// ─────────────────────────────────────────────── GMAIL

async function gmailList(req, res) {
  const tok = await ensureToken();
  if (!tok) return err(res, 401, 'no token');
  const u = new URL(req.url, 'http://x');
  const q = u.searchParams.get('q') || 'is:unread';
  const max = Math.min(50, parseInt(u.searchParams.get('max') || '10', 10));
  const r = await gApi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`, null, tok);
  if (r.status !== 200) return err(res, r.status, JSON.stringify(r.json));
  const ids = (r.json.messages || []).map((m) => m.id);
  // headers'ı çekmek için her ID'ye ayrı çağrı (paralel)
  const items = await Promise.all(ids.slice(0, max).map(async (id) => {
    const m = await gApi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, null, tok);
    if (m.status !== 200) return null;
    const h = (m.json.payload?.headers || []);
    const get = (n) => h.find((x) => x.name === n)?.value || '';
    return {
      id, snippet: m.json.snippet || '',
      subject: get('Subject'), from: get('From'), date: get('Date'),
      unread: (m.json.labelIds || []).includes('UNREAD'),
    };
  }));
  ok(res, { count: items.filter(Boolean).length, items: items.filter(Boolean) });
}

function decodeBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) {
    try { return Buffer.from(payload.body.data, 'base64').toString('utf-8'); } catch { return ''; }
  }
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      try { return Buffer.from(part.body.data, 'base64').toString('utf-8'); } catch {}
    }
    const inner = decodeBody(part);
    if (inner) return inner;
  }
  return '';
}

async function gmailGet(req, res) {
  const tok = await ensureToken();
  if (!tok) return err(res, 401, 'no token');
  const u = new URL(req.url, 'http://x');
  const id = u.searchParams.get('id');
  if (!id) return err(res, 400, 'id required');
  const r = await gApi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, null, tok);
  if (r.status !== 200) return err(res, r.status, JSON.stringify(r.json));
  const h = r.json.payload?.headers || [];
  const get = (n) => h.find((x) => x.name === n)?.value || '';
  ok(res, {
    id, subject: get('Subject'), from: get('From'), to: get('To'), date: get('Date'),
    body: decodeBody(r.json.payload).slice(0, 8000),
    snippet: r.json.snippet,
  });
}

function buildMime({ to, subject, body, from }) {
  const safeSubj = `=?utf-8?B?${Buffer.from(subject || '').toString('base64')}?=`;
  return [
    `From: ${from || 'me'}`,
    `To: ${to}`,
    `Subject: ${safeSubj}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``, body || '',
  ].join('\r\n');
}

async function gmailSend(req, res) {
  const tok = await ensureToken();
  if (!tok) return err(res, 401, 'no token');
  const body = JSON.parse((await readBody(req)) || '{}');
  if (!body.to || !body.subject) return err(res, 400, 'to + subject required');
  const raw = Buffer.from(buildMime(body)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const r = await gApi('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw }, tok);
  if (r.status >= 300) return err(res, r.status, JSON.stringify(r.json));
  ok(res, { id: r.json.id, thread_id: r.json.threadId });
}

async function gmailDraft(req, res) {
  const tok = await ensureToken();
  if (!tok) return err(res, 401, 'no token');
  const body = JSON.parse((await readBody(req)) || '{}');
  if (!body.to || !body.subject) return err(res, 400, 'to + subject required');
  const raw = Buffer.from(buildMime(body)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const r = await gApi('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { message: { raw } }, tok);
  if (r.status >= 300) return err(res, r.status, JSON.stringify(r.json));
  ok(res, { draft_id: r.json.id });
}

// ─────────────────────────────────────────────── CALENDAR

async function calUpcoming(req, res) {
  const tok = await ensureToken();
  if (!tok) return err(res, 401, 'no token');
  const u = new URL(req.url, 'http://x');
  const max = Math.min(50, parseInt(u.searchParams.get('max') || '10', 10));
  const timeMin = new Date().toISOString();
  const r = await gApi('GET',
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=${max}&timeMin=${encodeURIComponent(timeMin)}`,
    null, tok);
  if (r.status !== 200) return err(res, r.status, JSON.stringify(r.json));
  const items = (r.json.items || []).map((e) => ({
    id: e.id, summary: e.summary, location: e.location,
    start: e.start?.dateTime || e.start?.date,
    end:   e.end?.dateTime   || e.end?.date,
    attendees: (e.attendees || []).map((a) => a.email),
    link: e.htmlLink,
  }));
  ok(res, { count: items.length, items });
}

async function calCreate(req, res) {
  const tok = await ensureToken();
  if (!tok) return err(res, 401, 'no token');
  const body = JSON.parse((await readBody(req)) || '{}');
  if (!body.summary || !body.start) return err(res, 400, 'summary + start required (ISO 8601)');
  const event = {
    summary: body.summary,
    description: body.description,
    location: body.location,
    start: { dateTime: body.start, timeZone: body.timezone || 'Europe/Istanbul' },
    end:   { dateTime: body.end || body.start, timeZone: body.timezone || 'Europe/Istanbul' },
    attendees: (body.attendees || []).map((email) => ({ email })),
  };
  const r = await gApi('POST', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', event, tok);
  if (r.status >= 300) return err(res, r.status, JSON.stringify(r.json));
  ok(res, { id: r.json.id, link: r.json.htmlLink });
}

// ─────────────────────────────────────────────── TASKS

async function tasksList(_req, res) {
  const tok = await ensureToken();
  if (!tok) return err(res, 401, 'no token');
  // Önce default task list ID al
  const lists = await gApi('GET', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists', null, tok);
  const listId = lists.json?.items?.[0]?.id;
  if (!listId) return ok(res, { items: [] });
  const r = await gApi('GET', `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=false&maxResults=50`, null, tok);
  ok(res, { count: (r.json.items || []).length, items: (r.json.items || []).map((t) => ({
    id: t.id, title: t.title, notes: t.notes, due: t.due, status: t.status,
  })) });
}

async function tasksAdd(req, res) {
  const tok = await ensureToken();
  if (!tok) return err(res, 401, 'no token');
  const body = JSON.parse((await readBody(req)) || '{}');
  if (!body.title) return err(res, 400, 'title required');
  const lists = await gApi('GET', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists', null, tok);
  const listId = lists.json?.items?.[0]?.id;
  const r = await gApi('POST', `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
    title: body.title, notes: body.notes, due: body.due,
  }, tok);
  if (r.status >= 300) return err(res, r.status, JSON.stringify(r.json));
  ok(res, { id: r.json.id });
}

// ─────────────────────────────────────────────── DRIVE

async function driveRecent(req, res) {
  const tok = await ensureToken();
  if (!tok) return err(res, 401, 'no token');
  const u = new URL(req.url, 'http://x');
  const max = Math.min(50, parseInt(u.searchParams.get('max') || '10', 10));
  const r = await gApi('GET',
    `https://www.googleapis.com/drive/v3/files?orderBy=modifiedTime%20desc&pageSize=${max}&fields=files(id,name,mimeType,modifiedTime,webViewLink)`,
    null, tok);
  if (r.status !== 200) return err(res, r.status, JSON.stringify(r.json));
  ok(res, { count: (r.json.files || []).length, items: r.json.files });
}

// ─────────────────────────────────────────────── PEOPLE

async function peopleSearch(req, res) {
  const tok = await ensureToken();
  if (!tok) return err(res, 401, 'no token');
  const u = new URL(req.url, 'http://x');
  const q = u.searchParams.get('q') || '';
  if (!q) return err(res, 400, 'q required');
  const r = await gApi('GET',
    `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(q)}&pageSize=10&readMask=names,emailAddresses`,
    null, tok);
  if (r.status !== 200) return err(res, r.status, JSON.stringify(r.json));
  const items = (r.json.results || []).map((c) => ({
    name: c.person?.names?.[0]?.displayName,
    email: c.person?.emailAddresses?.[0]?.value,
  })).filter((c) => c.email);
  ok(res, { count: items.length, items });
}

// ─────────────────────────────────────────────── ROUTING

function shouldHandle(url) { return url.startsWith('/api/google/gmail/') || url.startsWith('/api/google/calendar/') || url.startsWith('/api/google/tasks/') || url.startsWith('/api/google/drive/') || url.startsWith('/api/google/people/'); }

async function handleHttp(req, res) {
  const u = req.url;
  if (req.method === 'GET'  && u.startsWith('/api/google/gmail/list'))     return gmailList(req, res);
  if (req.method === 'GET'  && u.startsWith('/api/google/gmail/get'))      return gmailGet(req, res);
  if (req.method === 'POST' && u.startsWith('/api/google/gmail/send'))     return gmailSend(req, res);
  if (req.method === 'POST' && u.startsWith('/api/google/gmail/draft'))    return gmailDraft(req, res);
  if (req.method === 'GET'  && u.startsWith('/api/google/calendar/upcoming')) return calUpcoming(req, res);
  if (req.method === 'POST' && u.startsWith('/api/google/calendar/create')) return calCreate(req, res);
  if (req.method === 'GET'  && u.startsWith('/api/google/tasks/list'))     return tasksList(req, res);
  if (req.method === 'POST' && u.startsWith('/api/google/tasks/add'))      return tasksAdd(req, res);
  if (req.method === 'GET'  && u.startsWith('/api/google/drive/recent'))   return driveRecent(req, res);
  if (req.method === 'GET'  && u.startsWith('/api/google/people/search'))  return peopleSearch(req, res);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
}

module.exports = { shouldHandle, handleHttp };
