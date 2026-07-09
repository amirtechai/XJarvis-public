/**
 * Unified inbox aggregator: Gmail + Telegram + WhatsApp + Slack + Linear + Jira.
 *
 *   GET  /api/inbox/feed?limit=50&since=ts → merged stream, AI-tagged tier
 *   POST /api/inbox/mark {id, source, status: 'archived'|'snoozed'|'replied'}
 *   GET  /api/inbox/digest                 → daily digest text (LLM-summarized)
 *
 * Pulls from local backend endpoints already present:
 *   /api/google/gmail/recent
 *   /api/whatsapp/threads
 *   /api/atlassian/issues, /linear/issues
 *
 * Tier classification (simple keyword + sender heuristics — Haiku for nuance):
 *   skip          — newsletters, automated notifications
 *   info_only     — FYI-level updates
 *   meeting_info  — calendar invites, time confirmations
 *   action_required — explicit asks, deadlines, @mentions
 */
const http = require('http');
const llm = require('./llm-sdk');

const cache = { feed: [], updated_at: 0 };

function getJsonLocal(path) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path, timeout: 4000 }, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(cs).toString())); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null)).on('timeout', function () { this.destroy(); resolve(null); });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on('data', (x) => c.push(x));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf-8')));
  });
}

function classifyTier(item) {
  const txt = `${item.subject || ''} ${item.body || item.text || ''}`.toLowerCase();
  const from = (item.from || '').toLowerCase();
  if (/noreply|no-reply|newsletter|notifications?@|digest|unsubscribe/.test(from)) return 'skip';
  if (/marketing|promo|sale|%\s*off|coupon|deal/.test(txt)) return 'skip';
  if (/\b(meeting|invite|kalender|calendar|toplantı|zoom|meet\.|teams)\b/.test(txt)) return 'meeting_info';
  if (/\bdeadline|asap|urgent|acil|önemli|@\w+|please review|need.*answer|reply by\b/.test(txt)) return 'action_required';
  if (/\b(update|fyi|info|bilgi|haber)\b/.test(txt)) return 'info_only';
  return 'info_only';
}

async function buildFeed() {
  const feed = [];
  const [gmail, wa, jira, linear] = await Promise.all([
    getJsonLocal('/api/google/gmail/recent?max=20'),
    getJsonLocal('/api/whatsapp/threads'),
    getJsonLocal('/api/atlassian/issues?max=15'),
    getJsonLocal('/api/linear/issues?max=15'),
  ]);

  if (gmail?.messages) {
    for (const m of gmail.messages.slice(0, 20)) {
      feed.push({
        id: `gm_${m.id}`,
        source: 'gmail',
        from: m.from || '',
        subject: m.subject || '',
        body: m.snippet || '',
        ts: m.date || m.internalDate || Date.now(),
        url: `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
        tier: classifyTier({ from: m.from, subject: m.subject, body: m.snippet }),
      });
    }
  }
  if (wa?.threads) {
    for (const t of wa.threads.slice(0, 15)) {
      const last = t.last_message || {};
      feed.push({
        id: `wa_${t.id}`,
        source: 'whatsapp',
        from: t.name || t.id,
        subject: '',
        body: last.text || '',
        ts: last.ts || Date.now(),
        unread: t.unread || 0,
        tier: classifyTier({ from: t.name, body: last.text }),
      });
    }
  }
  if (jira?.issues) {
    for (const i of jira.issues.slice(0, 10)) {
      feed.push({
        id: `jr_${i.key}`,
        source: 'jira',
        from: i.assignee || 'jira',
        subject: i.title || i.summary || i.key,
        body: i.description || '',
        ts: i.updated || Date.now(),
        url: i.url,
        tier: 'action_required',
      });
    }
  }
  if (linear?.issues) {
    for (const i of linear.issues.slice(0, 10)) {
      feed.push({
        id: `lin_${i.id}`,
        source: 'linear',
        from: i.assignee || 'linear',
        subject: i.title || '',
        body: i.description || '',
        ts: new Date(i.updatedAt || Date.now()).getTime(),
        url: i.url,
        tier: 'action_required',
      });
    }
  }

  feed.sort((a, b) => Number(b.ts) - Number(a.ts));
  cache.feed = feed;
  cache.updated_at = Date.now();
  return feed;
}

async function buildDigest() {
  const feed = cache.feed.length ? cache.feed : await buildFeed();
  const action = feed.filter((f) => f.tier === 'action_required').slice(0, 8);
  const meetings = feed.filter((f) => f.tier === 'meeting_info').slice(0, 5);
  const lang = (process.env.XJARVIS_LANG || 'tr').toLowerCase();
  const promptTr = `Patron için günün inbox özetini yaz. ${action.length} action item, ${meetings.length} toplantı bilgisi:

ACTION GEREKEN:
${action.map((a) => `- [${a.source}] ${a.from}: ${a.subject || a.body?.slice(0, 100)}`).join('\n')}

TOPLANTILAR:
${meetings.map((m) => `- [${m.source}] ${m.from}: ${m.subject || m.body?.slice(0, 80)}`).join('\n')}

3 paragrafta: (1) ne acil, (2) toplantı durumu, (3) bugün için öneri. Türkçe, kısa, "patron" hitabı.`;
  const promptEn = `Write today's inbox digest for sir. ${action.length} action items, ${meetings.length} meetings:

ACTION REQUIRED:
${action.map((a) => `- [${a.source}] ${a.from}: ${a.subject || a.body?.slice(0, 100)}`).join('\n')}

MEETINGS:
${meetings.map((m) => `- [${m.source}] ${m.from}: ${m.subject || m.body?.slice(0, 80)}`).join('\n')}

3 paragraphs: (1) what's urgent, (2) meeting status, (3) suggestion for today. English, concise, "sir" address.`;

  const r = await llm.complete({ prompt: lang === 'en' ? promptEn : promptTr });
  if (!r.ok) return { ok: false, error: r.error, preview: { action, meetings } };
  return { ok: true, text: r.text, counts: { action: action.length, meetings: meetings.length } };
}

function shouldHandle(url) { return url.startsWith('/api/inbox/'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/inbox/feed') {
      const limit = parseInt(u.searchParams.get('limit') || '50', 10);
      const since = parseInt(u.searchParams.get('since') || '0', 10);
      // Refresh if cache > 60s old
      if (Date.now() - cache.updated_at > 60_000) await buildFeed();
      const items = cache.feed.filter((f) => Number(f.ts) > since).slice(0, limit);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, items, total: cache.feed.length, updated_at: cache.updated_at }));
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/inbox/digest') {
      const r = await buildDigest();
      res.writeHead(r.ok ? 200 : 500);
      res.end(JSON.stringify(r));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/inbox/mark') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const item = cache.feed.find((f) => f.id === body.id);
      if (item) item.status = body.status;
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle, buildFeed, buildDigest };
