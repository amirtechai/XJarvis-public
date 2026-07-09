/**
 * WhatsApp bridge — Baileys-based personal account bridge.
 *
 * Activation (one-time):
 *   cd backend && npm install @whiskeysockets/baileys qrcode pino
 * Then restart the backend, scan the QR shown at /api/whatsapp/qr
 * (or in Preferences → WhatsApp), and your WA messages start flowing.
 *
 * Endpoints (always available; degrade gracefully if Baileys missing):
 *   GET  /api/whatsapp/state           → connected, qr_pending, error, deps_ok
 *   POST /api/whatsapp/send  body: { jid, text }
 *   POST /api/whatsapp/restart         → wipe session, reauth
 *   GET  /api/whatsapp/messages        → last 50 inbound messages (in-memory)
 *
 * Outbound messages from agent: the agent can call a future `whatsapp_send`
 * tool that POSTs to /api/whatsapp/send. Inbound messages are pushed onto
 * the existing event bus as INBOUND_MESSAGE so router.js can decide whether
 * to reply.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSION_DIR = path.join(os.homedir(), '.config', 'xjarvis', 'whatsapp-session');
let baileys = null;
let pino = null;
let qrcode = null;
let depsError = null;

try {
  baileys = require('@whiskeysockets/baileys');
  pino = require('pino');
  qrcode = require('qrcode');
} catch (e) {
  depsError = e.message;
}

let socket = null;
let lastQrDataUrl = null;
let qrPending = false;
let connected = false;
let lastError = null;
const inbox = [];  // ring buffer of last 50 messages

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function startSocket() {
  if (!baileys) return;
  if (socket) {
    try { socket.end(); } catch {}
    socket = null;
  }
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const { state, saveCreds } = await baileys.useMultiFileAuthState(SESSION_DIR);
  const logger = pino({ level: 'silent' });
  socket = baileys.makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['XJarvis', 'Chrome', '1.0'],
  });

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        lastQrDataUrl = await qrcode.toDataURL(qr, { width: 240 });
        qrPending = true;
      } catch (e) { lastError = `qr render: ${e.message}`; }
    }
    if (connection === 'open') {
      connected = true;
      qrPending = false;
      lastQrDataUrl = null;
      lastError = null;
      console.log('[wa] connected');
    }
    if (connection === 'close') {
      connected = false;
      const reason = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = reason === baileys.DisconnectReason?.loggedOut;
      lastError = lastDisconnect?.error?.message || 'closed';
      console.warn(`[wa] disconnected (${reason}); reconnect=${!loggedOut}`);
      if (!loggedOut) {
        setTimeout(() => startSocket().catch(() => {}), 5000);
      }
    }
  });

  socket.ev.on('messages.upsert', (m) => {
    if (m.type !== 'notify') return;
    for (const msg of m.messages || []) {
      if (msg.key?.fromMe) continue;
      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption
        || '';
      if (!text) continue;
      const entry = {
        ts: Date.now() / 1000,
        from: msg.key?.remoteJid,
        push_name: msg.pushName,
        text: text.slice(0, 2000),
      };
      inbox.push(entry);
      if (inbox.length > 50) inbox.shift();
      try {
        const { bus, EVENT_TYPES } = require('./events/bus');
        bus.emit(EVENT_TYPES.INBOUND_MESSAGE || 'INBOUND_MESSAGE', { channel: 'whatsapp', ...entry }, 'whatsapp');
      } catch {}
    }
  });
}

function getState() {
  return {
    deps_ok: !!baileys,
    deps_error: depsError,
    connected,
    qr_pending: qrPending,
    qr_data_url: lastQrDataUrl,
    last_error: lastError,
    inbox_count: inbox.length,
  };
}

async function sendMessage(jid, text) {
  if (!socket) return { ok: false, error: 'socket not started' };
  if (!connected) return { ok: false, error: 'not connected' };
  if (!jid || !text) return { ok: false, error: 'jid and text required' };
  try {
    await socket.sendMessage(jid, { text: String(text) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function restartSession() {
  try {
    if (socket) { try { socket.end(); } catch {} }
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
    connected = false;
    qrPending = false;
    lastQrDataUrl = null;
    lastError = null;
    await startSocket();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleHttp(req, res) {
  if (req.url === '/api/whatsapp/state' && req.method === 'GET') {
    return json(res, 200, getState());
  }
  if (req.url === '/api/whatsapp/messages' && req.method === 'GET') {
    return json(res, 200, { messages: inbox.slice() });
  }
  if (req.url === '/api/whatsapp/send' && req.method === 'POST') {
    let body; try { body = await readJsonBody(req); } catch { return json(res, 400, { ok: false }); }
    const r = await sendMessage(body.jid, body.text);
    return json(res, r.ok ? 200 : 400, r);
  }
  if (req.url === '/api/whatsapp/restart' && req.method === 'POST') {
    const r = await restartSession();
    return json(res, r.ok ? 200 : 500, r);
  }
  return null;
}

function shouldHandle(url) {
  return url.startsWith('/api/whatsapp/');
}

function start() {
  if (!baileys) {
    console.warn(`[wa] Baileys not installed (${depsError}). Run: cd backend && npm install @whiskeysockets/baileys qrcode pino`);
    return;
  }
  startSocket().catch((e) => { lastError = e.message; });
}

module.exports = { handleHttp, shouldHandle, start, sendMessage };
