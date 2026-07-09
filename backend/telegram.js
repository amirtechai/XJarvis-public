/**
 * Telegram bot bridge.
 *
 * - Long-polls Telegram getUpdates
 * - Forwards incoming messages from allowlisted chat IDs to the XJarvis agent
 * - Streams the agent's response back as a single Telegram message
 * - Endpoints:
 *     GET  /api/telegram/state   { configured, allowlist, last_error }
 *     POST /api/telegram/save    { token, allowlist: number[] }
 *     POST /api/telegram/test    { chat_id }   ← sends "XJarvis hazır"
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'telegram.json');

let token = '';
let allowlist = new Set();
let pollOffset = 0;
let pollAbort = false;
let lastError = '';

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return;
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    token = data.token || '';
    allowlist = new Set((data.allowlist || []).map(Number).filter(Number.isFinite));
  } catch (e) {
    console.warn('[telegram] config parse failed:', e.message);
  }
}

async function saveConfig(data) {
  try {
    await fs.promises.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    const tmp = `${CONFIG_PATH}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.promises.rename(tmp, CONFIG_PATH);
  } catch (e) {
    console.error('[telegram] save config failed:', e.message);
  }
}

function readJson(req) {
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

function tgRequest(method, body = {}, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    if (!token) return reject(new Error('no token'));
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        method: 'POST',
        hostname: 'api.telegram.org',
        path: `/bot${token}/${method}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function streamAgentReply(query, onChunk) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = http.request(
      {
        host: '127.0.0.1', port: 8767, path: '/agent/query', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 90_000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`agent ${res.statusCode}`));
          res.resume();
          return;
        }
        let buffer = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = block.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'text' && typeof ev.content === 'string') onChunk(ev.content);
            } catch { /* ignore */ }
          }
        });
        res.on('end', resolve);
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const { exec } = require('child_process');
const daily = require('./daily-brief');

const WHISPER_BIN = '/opt/homebrew/bin/whisper-cli';
const WHISPER_MODEL = path.join(os.homedir(), '.cache', 'whisper-models', 'ggml-small.bin');
const TMP_DIR = path.join(os.tmpdir(), 'xjarvis-tg');

function sh(cmd, timeout = 120_000) {
  return new Promise((resolve) => exec(cmd, { timeout, maxBuffer: 8 * 1024 * 1024 },
    (err, so, se) => resolve({ ok: !err, out: (so || '').trim(), err: (se || (err && err.message) || '').toString() })));
}

// Markdown ile gönder; parse hatası olursa düz metne düş. 4096 limiti için böl.
async function sendMd(chatId, text, extra = {}) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 3800) chunks.push(text.slice(i, i + 3800));
  for (let k = 0; k < chunks.length; k++) {
    const isLast = k === chunks.length - 1;
    const opts = { chat_id: chatId, text: chunks[k], parse_mode: 'Markdown', disable_web_page_preview: true, ...(isLast ? extra : {}) };
    const r = await tgRequest('sendMessage', opts).catch(() => null);
    if (!r || !r.ok) {
      const { parse_mode, ...plain } = opts;
      await tgRequest('sendMessage', plain).catch(() => {});
    }
  }
}

// Telegram dosyasını yerel tmp'ye indir; yol döndür.
async function downloadTgFile(fileId) {
  const gf = await tgRequest('getFile', { file_id: fileId });
  const fp = gf?.result?.file_path;
  if (!fp) throw new Error('getFile başarısız');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const dest = path.join(TMP_DIR, `${Date.now()}_${path.basename(fp)}`);
  await new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/file/bot${token}/${fp}`, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`indirme ${res.statusCode}`)); }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    }).on('error', reject);
  });
  return dest;
}

async function transcribeVoice(srcPath) {
  const wav = `${srcPath}.wav`;
  const conv = await sh(`ffmpeg -y -i "${srcPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wav}" 2>/dev/null`);
  if (!conv.ok) throw new Error('ffmpeg dönüştürme hatası');
  const base = wav.replace(/\.wav$/, '');
  await sh(`"${WHISPER_BIN}" -m "${WHISPER_MODEL}" -f "${wav}" -l auto --output-txt -of "${base}" 2>/dev/null`);
  let text = '';
  try { text = fs.readFileSync(`${base}.txt`, 'utf-8').trim(); } catch {}
  [srcPath, wav, `${base}.txt`].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  return text;
}

// Yerel görselden OCR (macOS Shortcut, best-effort).
function ocrLocal(filePath) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ file_path: filePath });
    const req = http.request({ host: '127.0.0.1', port: 3001, path: '/api/media/ocr', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 65_000 },
      (res) => { const cs = []; res.on('data', (c) => cs.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(cs).toString())); } catch { resolve({ ok: false }); } }); });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.write(body); req.end();
  });
}

// Komut -> composer eşlemesi
const COMMAND_COMPOSERS = {
  '/piyasa': () => daily.composeMarkets(),
  '/borsa': () => daily.composeMarkets(),
  '/haber': () => daily.composeNews(),
  '/namaz': () => daily.composePrayer(),
  '/ezan': () => daily.composePrayer(),
  '/ayet': () => Promise.resolve(daily.composeAyah()),
  '/hadis': () => Promise.resolve(daily.composeHadith()),
  '/motivasyon': () => Promise.resolve(daily.composeMotivation()),
  '/brief': () => daily.composeFull(),
  '/brifing': () => daily.composeFull(),
};

const CALLBACK_TO_CMD = { piyasa: '/piyasa', haber: '/haber', namaz: '/namaz', ayet: '/ayet', hadis: '/hadis', motivasyon: '/motivasyon', brief: '/brief' };

function menuKeyboard() {
  return { inline_keyboard: [
    [{ text: '📊 Piyasa', callback_data: 'piyasa' }, { text: '📰 Haber', callback_data: 'haber' }],
    [{ text: '🕌 Namaz', callback_data: 'namaz' }, { text: '📖 Ayet', callback_data: 'ayet' }],
    [{ text: '☪️ Hadis', callback_data: 'hadis' }, { text: '💪 Motivasyon', callback_data: 'motivasyon' }],
    [{ text: '🗓️ Tam Brifing', callback_data: 'brief' }],
  ] };
}

const HELP_TEXT = [
  '🤖 *XJarvis* hazır. Aşağıdaki butonları kullanabilir veya yazabilirsin.',
  '',
  '*Komutlar:*',
  '/brief — Tam günlük brifing',
  '/piyasa — Borsa, döviz, altın, kripto',
  '/haber — Yapay zeka & teknoloji haberleri',
  '/namaz — Balıkesir namaz vakitleri + hicri',
  '/ayet — Günün ayeti', '/hadis — Günün hadisi', '/motivasyon — Günün sözü',
  '/status — Sistem durumu', '/menu — Buton menüsü',
  '',
  '🎙️ Sesli mesaj gönderebilirsin (yazıya çevirip yanıtlarım).',
  '🖼️ Foto/belge gönderebilirsin (içeriğini okurum).',
].join('\n');

async function runComposerCommand(chatId, cmd) {
  await tgRequest('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  try {
    const text = await COMMAND_COMPOSERS[cmd]();
    await sendMd(chatId, text);
  } catch (e) {
    await tgRequest('sendMessage', { chat_id: chatId, text: `[veri alınamadı: ${e.message}]` }).catch(() => {});
  }
}

async function runAgent(chatId, query) {
  await tgRequest('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  let assembled = '';
  try { await streamAgentReply(query, (c) => { assembled += c; }); }
  catch (e) { await tgRequest('sendMessage', { chat_id: chatId, text: `[hata: ${e.message}]` }).catch(() => {}); return; }
  if (!assembled.trim()) { await tgRequest('sendMessage', { chat_id: chatId, text: '(boş yanıt)' }).catch(() => {}); return; }
  for (let i = 0; i < assembled.length; i += 4000) {
    await tgRequest('sendMessage', { chat_id: chatId, text: assembled.slice(i, i + 4000) }).catch(() => {});
  }
}

async function handleCallback(cq) {
  const chatId = cq.message?.chat?.id;
  const data = cq.data;
  await tgRequest('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
  if (!chatId || !allowlist.has(chatId)) return;
  const cmd = CALLBACK_TO_CMD[data];
  if (cmd) await runComposerCommand(chatId, cmd);
}

async function handleStatus(chatId) {
  const probe = () => new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 8767, path: '/health', timeout: 2500 }, (r) => { r.resume(); resolve(r.statusCode === 200); })
      .on('error', () => resolve(false)).on('timeout', function () { this.destroy(); resolve(false); });
  });
  const agentUp = await probe();
  const txt = ['🩺 *Durum*', '', `• Bot: ✅ çalışıyor`, `• Agent: ${agentUp ? '✅ ayakta' : '❌ erişilemiyor'}`,
    `• Allowlist: ${allowlist.size} kişi`].join('\n');
  await sendMd(chatId, txt);
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;
  if (!allowlist.has(chatId)) {
    await tgRequest('sendMessage', {
      chat_id: chatId,
      text: `Bu chat ID (${chatId}) allowlist'te yok. Sahibi senin /preferences sayfanda eklesin.`,
    });
    return;
  }

  // 1) Sesli mesaj → whisper transkript → agent
  if (msg.voice || msg.audio) {
    const fileId = (msg.voice || msg.audio).file_id;
    await tgRequest('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    try {
      const local = await downloadTgFile(fileId);
      const transcript = await transcribeVoice(local);
      if (!transcript) { await tgRequest('sendMessage', { chat_id: chatId, text: '(ses çözümlenemedi)' }).catch(() => {}); return; }
      await tgRequest('sendMessage', { chat_id: chatId, text: `🎙️ _“${transcript}”_`, parse_mode: 'Markdown' }).catch(() => {});
      await runAgent(chatId, transcript);
    } catch (e) {
      await tgRequest('sendMessage', { chat_id: chatId, text: `[ses hatası: ${e.message}]` }).catch(() => {});
    }
    return;
  }

  // 2) Foto → OCR → agent (caption bağlam olarak)
  if (msg.photo && msg.photo.length) {
    const fileId = msg.photo[msg.photo.length - 1].file_id; // en büyük boy
    const caption = (msg.caption || '').trim();
    await tgRequest('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    try {
      const local = await downloadTgFile(fileId);
      const r = await ocrLocal(local);
      try { fs.unlinkSync(local); } catch {}
      const ocrText = (r && r.ok && r.text) ? r.text : '';
      let query;
      if (ocrText) query = `Kullanıcı bir görsel gönderdi. Görselden okunan metin:\n"""${ocrText}"""\n${caption ? `Kullanıcının notu: ${caption}` : 'Bu içeriği yorumla / özetle.'}`;
      else query = `Kullanıcı bir görsel gönderdi${caption ? ` ve şu notu ekledi: "${caption}"` : ''}. Görselden metin okunamadı (OCR boş). ${caption ? 'Nota göre yardımcı ol.' : 'Görseli açıklayamadığımı kibarca belirt ve metin içeren bir görsel istersen okuyabileceğimi söyle.'}`;
      await runAgent(chatId, query);
    } catch (e) {
      await tgRequest('sendMessage', { chat_id: chatId, text: `[foto hatası: ${e.message}]` }).catch(() => {});
    }
    return;
  }

  // 3) Belge → metinse içeriğini, değilse adını agent'a ver
  if (msg.document) {
    const doc = msg.document;
    const caption = (msg.caption || '').trim();
    const name = doc.file_name || 'dosya';
    const mime = doc.mime_type || '';
    await tgRequest('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    try {
      let query;
      const isText = /^text\//.test(mime) || /\.(txt|md|csv|json|log|js|ts|py|html|css)$/i.test(name);
      if (isText && (doc.file_size || 0) < 200_000) {
        const local = await downloadTgFile(doc.file_id);
        let body = '';
        try { body = (await fs.promises.readFile(local, 'utf-8')).slice(0, 12_000); } catch {}
        try { await fs.promises.unlink(local); } catch {}
        query = `Kullanıcı "${name}" adlı dosyayı gönderdi. İçeriği:\n"""${body}"""\n${caption || 'Bu dosyayı özetle / yorumla.'}`;
      } else {
        const local = await downloadTgFile(doc.file_id).catch(() => null);
        const r = local ? await ocrLocal(local) : { ok: false };
        if (local) try { await fs.promises.unlink(local); } catch {}
        if (r && r.ok && r.text) query = `Kullanıcı "${name}" belgesini gönderdi. Okunan metin:\n"""${r.text}"""\n${caption || 'Özetle.'}`;
        else query = `Kullanıcı "${name}" (${mime || 'bilinmeyen tür'}) belgesini gönderdi${caption ? `, notu: "${caption}"` : ''}. İçeriğini doğrudan okuyamadım; nasıl yardımcı olabileceğimi sor.`;
      }
      await runAgent(chatId, query);
    } catch (e) {
      await tgRequest('sendMessage', { chat_id: chatId, text: `[belge hatası: ${e.message}]` }).catch(() => {});
    }
    return;
  }

  const text = msg.text?.trim();
  if (!text) return;

  // 4) Komutlar
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
  if (cmd === '/start' || cmd === '/help' || cmd === '/menu') {
    await tgRequest('sendMessage', { chat_id: chatId, text: HELP_TEXT, parse_mode: 'Markdown', reply_markup: menuKeyboard() }).catch(() => {});
    return;
  }
  if (cmd === '/status') { await handleStatus(chatId); return; }
  if (cmd === '/reset') {
    await new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: 8767, path: '/reset', method: 'POST', timeout: 4000 }, (res) => { res.resume(); resolve(); });
      r.on('error', () => resolve()); r.on('timeout', () => { r.destroy(); resolve(); }); r.end();
    });
    await tgRequest('sendMessage', { chat_id: chatId, text: '🧹 Konuşma sıfırlandı (yeni bağlam).' }).catch(() => {});
    return;
  }
  if (COMMAND_COMPOSERS[cmd]) { await runComposerCommand(chatId, cmd); return; }

  // 5) Serbest metin → agent
  await runAgent(chatId, text);
}

async function pollLoop() {
  while (!pollAbort) {
    if (!token) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    try {
      const res = await tgRequest('getUpdates', { offset: pollOffset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 60_000);
      if (res.ok && Array.isArray(res.result)) {
        for (const upd of res.result) {
          pollOffset = Math.max(pollOffset, upd.update_id + 1);
          if (upd.message) {
            handleMessage(upd.message).catch((e) => console.warn('[telegram] handler error:', e.message));
          } else if (upd.callback_query) {
            handleCallback(upd.callback_query).catch((e) => console.warn('[telegram] callback error:', e.message));
          }
        }
        lastError = '';
      } else if (!res.ok) {
        lastError = res.description || 'unknown';
        console.warn('[telegram] getUpdates not ok:', res);
        await new Promise((r) => setTimeout(r, 5000));
      }
    } catch (e) {
      lastError = e.message;
      // typical: ECONNRESET on long-poll timeout — retry quickly
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function registerCommands() {
  const commands = [
    { command: 'brief', description: 'Tam günlük brifing' },
    { command: 'piyasa', description: 'Borsa, döviz, altın, kripto' },
    { command: 'haber', description: 'Yapay zeka & teknoloji haberleri' },
    { command: 'namaz', description: 'Balıkesir namaz vakitleri + hicri' },
    { command: 'ayet', description: 'Günün ayeti' },
    { command: 'hadis', description: 'Günün hadisi' },
    { command: 'motivasyon', description: 'Günün sözü' },
    { command: 'status', description: 'Sistem durumu' },
    { command: 'menu', description: 'Buton menüsü' },
  ];
  tgRequest('setMyCommands', { commands }).catch(() => {});
}

async function start() {
  loadConfig();
  registerCommands();
  daily.start((text) => sendMdToAllowlist(text));
  // When the server-side webhook is active, Telegram delivers messages to
  // xjarvis.your-domain.example instead of long-poll. Skip the local poller so
  // we don't burn CPU on 409 responses.
  if (process.env.XJARVIS_TG_REMOTE === '1') {
    console.log('[telegram] remote webhook active — local poll disabled');
    return;
  }
  pollLoop().catch((e) => console.error('[telegram] poll loop crashed:', e));
}

async function stateHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    configured: !!token,
    allowlist: [...allowlist],
    last_error: lastError || null,
  }));
}

async function saveHandler(req, res) {
  let body;
  try { body = await readJson(req); } catch { res.writeHead(400); res.end(); return; }
  const newToken = String(body.token || '').trim();
  const list = Array.isArray(body.allowlist) ? body.allowlist.map(Number).filter(Number.isFinite) : [];
  if (!newToken) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'token required' }));
    return;
  }
  // Validate the token by calling getMe
  const prevToken = token;
  token = newToken;
  let me;
  try { me = await tgRequest('getMe', {}, 8000); }
  catch (e) {
    token = prevToken;
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `validate failed: ${e.message}` }));
    return;
  }
  if (!me?.ok) {
    token = prevToken;
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: me?.description || 'invalid token' }));
    return;
  }
  allowlist = new Set(list);
  await saveConfig({ token, allowlist: [...allowlist] });
  pollOffset = 0;  // restart from latest after token change
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, bot: me.result }));
}

async function testHandler(req, res) {
  let body;
  try { body = await readJson(req); } catch { res.writeHead(400); res.end(); return; }
  const chat = Number(body.chat_id);
  if (!Number.isFinite(chat)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'chat_id required' }));
    return;
  }
  try {
    const r = await tgRequest('sendMessage', { chat_id: chat, text: 'XJarvis test mesajı — bağlantı çalışıyor.' });
    res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r));
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

function handleHttp(req, res) {
  if (!req.url.startsWith('/api/telegram')) return null;
  if (req.method === 'GET' && req.url === '/api/telegram/state') return stateHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/telegram/save')  return saveHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/telegram/test')  return testHandler(req, res);
  res.writeHead(404);
  res.end();
  return undefined;
}

async function sendToAllowlist(text) {
  if (!token || allowlist.size === 0) return { ok: false, error: 'not configured' };
  const results = [];
  for (const chat of allowlist) {
    try {
      const r = await tgRequest('sendMessage', { chat_id: chat, text, parse_mode: 'HTML' });
      results.push({ chat, ok: !!r.ok });
    } catch (e) {
      results.push({ chat, ok: false, error: e.message });
    }
  }
  return { ok: true, results };
}

async function sendMdToAllowlist(text) {
  if (!token || allowlist.size === 0) return { ok: false, error: 'not configured' };
  for (const chat of allowlist) { try { await sendMd(chat, text); } catch {} }
  return { ok: true };
}

module.exports = { handleHttp, start, sendToAllowlist, sendMdToAllowlist };
