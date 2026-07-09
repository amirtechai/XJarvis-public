/**
 * Google Workspace araçları — Calendar + Tasks + Gmail (server-side, refresh token ile 7/24).
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.
 */
let _at = null, _exp = 0;
async function token() {
  if (_at && Date.now() < _exp - 60_000) return _at;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('google token: ' + JSON.stringify(j).slice(0, 160));
  _at = j.access_token; _exp = Date.now() + (j.expires_in || 3600) * 1000;
  return _at;
}
async function gapi(url, method = 'GET', body) {
  const t = await token();
  const r = await fetch(url, {
    method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j;
}
const enabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN);
const fmt = (iso) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' });

const TOOLS = [
  { name: 'get_calendar_events', description: 'Google Takvim\'deki yaklaşan etkinlikleri getir (varsayılan 7 gün).',
    input_schema: { type: 'object', properties: { days: { type: 'number' } } } },
  { name: 'create_calendar_event', description: 'Google Takvim\'e etkinlik ekle. start/end ISO 8601 +03:00 ofsetli (Europe/Istanbul).',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, description: { type: 'string' } }, required: ['title', 'start'] } },
  { name: 'list_tasks', description: 'Google Tasks görevlerini listele.', input_schema: { type: 'object', properties: {} } },
  { name: 'add_task', description: 'Google Tasks\'a görev ekle. due opsiyonel, ISO 8601.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string' } }, required: ['title'] } },
  { name: 'list_recent_emails', description: 'Gmail\'de son/önemli e-postaları listele. query opsiyonel (Gmail arama sözdizimi).',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'number' } } } },
  { name: 'read_email', description: 'Bir Gmail mesajını id ile oku (gövde metni).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

function decodeBody(payload) {
  const dec = (d) => Buffer.from((d || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  if (!payload) return '';
  if (payload.body?.data && (payload.mimeType || '').startsWith('text/plain')) return dec(payload.body.data);
  for (const p of payload.parts || []) {
    if ((p.mimeType || '').startsWith('text/plain') && p.body?.data) return dec(p.body.data);
  }
  for (const p of payload.parts || []) { const t = decodeBody(p); if (t) return t; }
  return payload.body?.data ? dec(payload.body.data) : '';
}

const TOOL_IMPL = {
  get_calendar_events: async ({ days = 7 }) => {
    const now = new Date().toISOString();
    const max = new Date(Date.now() + days * 86400000).toISOString();
    const j = await gapi(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${max}&singleEvents=true&orderBy=startTime&maxResults=20`);
    const items = j.items || [];
    if (!items.length) return 'yaklaşan etkinlik yok';
    return items.map((e) => `• ${e.summary || '(başlıksız)'} — ${fmt(e.start?.dateTime || e.start?.date)}`).join('\n');
  },
  create_calendar_event: async ({ title, start, end, description }) => {
    const ev = { summary: title, description: description || '',
      start: { dateTime: start, timeZone: 'Europe/Istanbul' },
      end: { dateTime: end || new Date(Date.parse(start) + 3600000).toISOString(), timeZone: 'Europe/Istanbul' } };
    const j = await gapi('https://www.googleapis.com/calendar/v3/calendars/primary/events', 'POST', ev);
    return `Etkinlik eklendi: ${title} — ${fmt(j.start?.dateTime)}`;
  },
  list_tasks: async () => {
    const j = await gapi('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=30');
    const items = j.items || [];
    if (!items.length) return 'görev yok';
    return items.map((t) => `• ${t.title}${t.due ? ' — ' + fmt(t.due) : ''}`).join('\n');
  },
  add_task: async ({ title, due }) => {
    const body = { title }; if (due) body.due = new Date(due).toISOString();
    await gapi('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', 'POST', body);
    return `Görev eklendi: ${title}`;
  },
  list_recent_emails: async ({ query, max = 8 }) => {
    const q = encodeURIComponent(query || 'in:inbox');
    const list = await gapi(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`);
    if (!list.messages?.length) return 'eşleşen e-posta yok';
    const out = [];
    for (const m of list.messages.slice(0, max)) {
      const msg = await gapi(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      const h = Object.fromEntries((msg.payload?.headers || []).map((x) => [x.name, x.value]));
      out.push(`📧 [${m.id}] ${h.Subject || '(konu yok)'} — ${(h.From || '').replace(/<.*>/, '').trim()}`);
    }
    return out.join('\n');
  },
  read_email: async ({ id }) => {
    const msg = await gapi(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
    const h = Object.fromEntries((msg.payload?.headers || []).map((x) => [x.name, x.value]));
    const body = decodeBody(msg.payload).slice(0, 3000);
    return `Konu: ${h.Subject || ''}\nKimden: ${h.From || ''}\n\n${body || msg.snippet || ''}`;
  },
};

module.exports = { TOOLS, TOOL_IMPL, enabled };
