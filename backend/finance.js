/**
 * Finance — crypto price alerts watcher.
 *
 * Persists alerts in ~/.config/xjarvis/finance-alerts.json. Every 60s polls
 * Binance for the symbols in the active set and pings Telegram when an alert
 * triggers. Alerts are one-shot — fired alerts are removed.
 *
 * Endpoints:
 *   GET    /api/finance/alerts             → list
 *   POST   /api/finance/alerts             → add { symbol, op, price, note? }
 *   DELETE /api/finance/alerts             → body { id }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { sendToAllowlist } = require('./telegram');

const STATE_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'finance-alerts.json');

let alerts = [];
let nextId = 1;
let timer = null;

function load() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const j = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
      alerts = Array.isArray(j.alerts) ? j.alerts : [];
      nextId = Number(j.next_id) || (alerts.reduce((m, a) => Math.max(m, a.id), 0) + 1);
    }
  } catch (e) { console.warn('[fin] load:', e.message); }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ alerts, next_id: nextId }, null, 2));
  } catch (e) { console.warn('[fin] save:', e.message); }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const cs = [];
    req.on('data', (c) => cs.push(c));
    req.on('end', () => {
      try { resolve(cs.length ? JSON.parse(Buffer.concat(cs).toString()) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function fetchPrices(symbols) {
  return new Promise((resolve) => {
    if (!symbols.length) return resolve({});
    // Compact JSON, no spaces — Binance enforces strict pattern
    const qp = encodeURIComponent(JSON.stringify(symbols).replace(/\s/g, ''));
    const url = `https://api.binance.com/api/v3/ticker/price?symbols=${qp}`;
    https.get(url, (res) => {
      const cs = [];
      res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        try {
          const arr = JSON.parse(Buffer.concat(cs).toString());
          const out = {};
          for (const p of (Array.isArray(arr) ? arr : [arr])) {
            out[p.symbol] = parseFloat(p.price);
          }
          resolve(out);
        } catch { resolve({}); }
      });
    }).on('error', () => resolve({}));
  });
}

async function tick() {
  if (!alerts.length) return;
  const symbols = [...new Set(alerts.map((a) => a.symbol))];
  const prices = await fetchPrices(symbols);
  const triggered = [];
  alerts = alerts.filter((a) => {
    const p = prices[a.symbol];
    if (p == null) return true;
    const fire = a.op === 'above' ? p >= a.price : p <= a.price;
    if (fire) {
      triggered.push({ ...a, fired_at: p });
      return false;
    }
    return true;
  });
  if (triggered.length) {
    save();
    for (const t of triggered) {
      const arrow = t.op === 'above' ? '🚀' : '📉';
      const text = `${arrow} <b>${t.symbol}</b> ${t.op} $${t.price}\nFiyat: $${t.fired_at}${t.note ? `\n${t.note}` : ''}`;
      try { await sendToAllowlist(text); } catch (e) { console.warn('[fin] tg:', e.message); }
      console.log(`[fin] alert #${t.id} fired: ${t.symbol} ${t.op} ${t.price} → ${t.fired_at}`);
    }
  }
}

function start() {
  load();
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick().catch((e) => console.warn('[fin] tick:', e.message)), 60_000);
  console.log(`[fin] watcher started (${alerts.length} alarms)`);
}

async function handleHttp(req, res) {
  if (req.url === '/api/finance/alerts' && req.method === 'GET') {
    return json(res, 200, { alerts });
  }
  if (req.url === '/api/finance/alerts' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req); } catch { return json(res, 400, { ok: false }); }
    const symbol = String(body.symbol || '').toUpperCase().trim();
    const op = body.op === 'above' || body.op === 'below' ? body.op : null;
    const price = Number(body.price);
    if (!symbol || !op || !isFinite(price)) {
      return json(res, 400, { ok: false, error: 'symbol, op (above|below), price required' });
    }
    const entry = { id: nextId++, symbol, op, price, note: String(body.note || '').slice(0, 200), created_at: Date.now() / 1000 };
    alerts.push(entry);
    save();
    return json(res, 200, { ok: true, id: entry.id });
  }
  if (req.url === '/api/finance/alerts' && req.method === 'DELETE') {
    let body;
    try { body = await readJsonBody(req); } catch { return json(res, 400, { ok: false }); }
    const id = Number(body.id);
    const before = alerts.length;
    alerts = alerts.filter((a) => a.id !== id);
    if (alerts.length === before) return json(res, 404, { ok: false, error: 'not found' });
    save();
    return json(res, 200, { ok: true });
  }
  return null;
}

function shouldHandle(url) {
  return url.startsWith('/api/finance/');
}

module.exports = { handleHttp, shouldHandle, start };
