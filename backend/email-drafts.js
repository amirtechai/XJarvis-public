/**
 * Email auto-draft + approval flow.
 *
 * Apple Mail'in inbox'ından son N "personal" maili çek, her biri için LLM
 * Türkçe cevap taslağı yaz, kullanıcı UI'da onayla → Apple Mail'de draft
 * olarak hazırlanır (kullanıcı son göz atıp gönderir).
 *
 * Asla otomatik göndermez — sadece DRAFT yaratır.
 *
 * REST:
 *   GET  /api/email-drafts                 → pending list
 *   POST /api/email-drafts/refresh         → run pipeline now
 *   POST /api/email-drafts/:id/approve     → create Mail draft, mark approved
 *   POST /api/email-drafts/:id/dismiss     → drop
 *   POST /api/email-drafts/:id/edit        → { body } update draft text
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

const STATE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'email-drafts.json');

let drafts = []; // {id, subject, sender, snippet, draft, status, ts}
let nextId = 1;
loadState();

function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    drafts = j.drafts || []; nextId = j.nextId || 1;
  } catch {}
}
function saveState() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ drafts, nextId }, null, 2));
}

function osa(script, ms = 12000) {
  return new Promise((resolve) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: ms }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

async function fetchRecentPersonalMails(limit = 10) {
  // Pull latest unread mail (subject, sender, body) from Apple Mail inbox.
  const script = `
    set out to ""
    tell application "Mail"
      set msgs to messages of inbox whose read status is false
      set N to count of msgs
      if N > ${limit} then set N to ${limit}
      repeat with i from 1 to N
        set m to item i of msgs
        try
          set s to sender of m
        on error
          set s to ""
        end try
        try
          set sub to subject of m
        on error
          set sub to ""
        end try
        try
          set bd to (content of m)
        on error
          set bd to ""
        end try
        set out to out & sub & "|||" & s & "|||" & (text 1 thru (min(800, length of bd)) of bd) & "<<<END>>>"
      end repeat
    end tell
    return out
  `.replace('min(800, length of bd)', '(get a) where a is missing value');
  // AppleScript doesn't have min() directly; simpler: trim later in JS.
  const fallback = `
    set out to ""
    tell application "Mail"
      set msgs to messages of inbox whose read status is false
      set N to count of msgs
      if N > ${limit} then set N to ${limit}
      repeat with i from 1 to N
        set m to item i of msgs
        try
          set s to sender of m
        on error
          set s to ""
        end try
        try
          set sub to subject of m
        on error
          set sub to ""
        end try
        try
          set bd to (content of m as string)
        on error
          set bd to ""
        end try
        set out to out & sub & "|||" & s & "|||" & bd & "<<<END>>>"
      end repeat
    end tell
    return out
  `;
  const raw = await osa(fallback, 25000);
  if (!raw) return [];
  return raw.split('<<<END>>>').filter(Boolean).map((chunk) => {
    const [subject, sender, body] = chunk.split('|||');
    return {
      subject: (subject || '').trim(),
      sender: (sender || '').trim(),
      body: (body || '').trim().slice(0, 1500),
    };
  }).filter((m) => m.subject);
}

function callLLM(messages, { temperature = 0.4 } = {}) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-EmailDraft' },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const content = (j.choices?.[0]?.message?.content || '{}').trim().replace(/^```\w*\n?|\n?```$/g, '');
          resolve(JSON.parse(content));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.write(payload); req.end();
  });
}

const DRAFT_SYS = `Sen kullanıcının e-postalarına Türkçe cevap taslağı yazıyorsun.
Önce mailin "personal" mi yoksa "skip" (newsletter, promo, otomatik) mi olduğuna karar ver.
Personal ise kısa, profesyonel ama doğal bir cevap üret. Tipik 3-5 cümle. İmza ekleme.
Cevabını şu JSON şemasında döndür:
{
  "category": "personal" | "skip",
  "draft": "<cevap metni — sadece body>",
  "rationale": "<neden bu cevap, kısa>"
}`;

async function generateDraft(mail) {
  const r = await callLLM([
    { role: 'system', content: DRAFT_SYS },
    { role: 'user', content: `Mail:\nGönderen: ${mail.sender}\nKonu: ${mail.subject}\nİçerik:\n${mail.body}` },
  ]);
  return r;
}

async function refresh({ limit = 6 } = {}) {
  const mails = await fetchRecentPersonalMails(limit);
  let added = 0;
  for (const m of mails) {
    const dup = drafts.some((d) => d.subject === m.subject && d.sender === m.sender);
    if (dup) continue;
    const r = await generateDraft(m);
    if (!r || r.category !== 'personal' || !r.draft) continue;
    drafts.unshift({
      id: nextId++,
      subject: m.subject, sender: m.sender, snippet: m.body.slice(0, 200),
      draft: r.draft, rationale: r.rationale || '',
      status: 'pending', ts: Date.now(),
    });
    added++;
  }
  // Keep only last 50
  drafts = drafts.slice(0, 50);
  saveState();
  return { ok: true, total: drafts.length, added };
}

function listDrafts() { return drafts; }

async function approve(id) {
  const d = drafts.find((x) => x.id === id);
  if (!d) return { ok: false, error: 'not found' };
  // Create Apple Mail draft via osascript. The user reviews and sends manually.
  // Recipient address is the bare email parsed out of the sender string.
  const emailMatch = d.sender.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const to = emailMatch ? emailMatch[0] : '';
  const reSubject = /^re:/i.test(d.subject) ? d.subject : `Re: ${d.subject}`;
  const escaped = d.draft.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const script = `
    tell application "Mail"
      set newMsg to make new outgoing message with properties {subject:"${reSubject.replace(/"/g, '\\"')}", content:"${escaped}", visible:true}
      tell newMsg to make new to recipient with properties {address:"${to}"}
      activate
    end tell
  `;
  await osa(script, 8000);
  d.status = 'approved'; saveState();
  return { ok: true, draft: d };
}

function dismiss(id) {
  drafts = drafts.filter((x) => x.id !== id); saveState();
  return { ok: true };
}

function editDraft(id, body) {
  const d = drafts.find((x) => x.id === id);
  if (!d) return { ok: false, error: 'not found' };
  d.draft = String(body || '').slice(0, 8000);
  saveState();
  return { ok: true, draft: d };
}

function shouldHandle(url) { return url.startsWith('/api/email-drafts'); }
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/api\/email-drafts\/(\d+)\/(approve|dismiss|edit)$/);
    if (req.method === 'GET' && url.pathname === '/api/email-drafts') {
      res.writeHead(200); res.end(JSON.stringify(listDrafts())); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/email-drafts/refresh') {
      const r = await refresh();
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (m && m[2] === 'approve' && req.method === 'POST') {
      const r = await approve(Number(m[1]));
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (m && m[2] === 'dismiss' && req.method === 'POST') {
      res.writeHead(200); res.end(JSON.stringify(dismiss(Number(m[1])))); return;
    }
    if (m && m[2] === 'edit' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      res.writeHead(200); res.end(JSON.stringify(editDraft(Number(m[1]), body.body))); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { refresh, listDrafts, approve, dismiss, editDraft, shouldHandle, handleHttp };
