/**
 * xjarvis-server Telegram eklentileri — komutlar, sesli mesaj, foto (vision),
 * inline buton menüsü ve günlük brifing push'u.
 *
 * ctx: { TG_TOKEN, TG_CHAT, enqueueCmd, pendingCount, anthropic, AGENT_MODEL,
 *        SYS_PROMPT, transcribeGroq, transcribeDeepgram }
 */
const daily = require('./daily-brief');
const ingest = require('./file-ingest');
const tasavvuf = require('./tasavvuf-content');
const ytFeed = require('./youtube-feed');
const bookFeed = require('./book-feed');
const filmFeed = require('./film-feed');
const cp = require('child_process');
const fss = require('fs');
const pth = require('path');
const os = require('os');

module.exports = function createTgHandlers(ctx) {
  const { TG_TOKEN, TG_CHAT, enqueueCmd, pendingCount, anthropic, AGENT_MODEL, SYS_PROMPT,
    transcribeGroq, transcribeDeepgram, runServerAgent, ELEVEN_KEY, ELEVEN_VOICE, ELEVEN_MODEL } = ctx;

  const api = (method, body) =>
    fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => ({ ok: false }));

  async function send(text, chatId, extra = {}) {
    const cid = chatId || TG_CHAT;
    if (!TG_TOKEN || !cid) return;
    const chunks = [];
    for (let i = 0; i < text.length; i += 3800) chunks.push(text.slice(i, i + 3800));
    if (!chunks.length) chunks.push('');
    for (let k = 0; k < chunks.length; k++) {
      const last = k === chunks.length - 1;
      const base = { chat_id: cid, text: chunks[k], parse_mode: 'Markdown', disable_web_page_preview: true, ...(last ? extra : {}) };
      const j = await api('sendMessage', base);
      if (!j || !j.ok) { const { parse_mode, ...plain } = base; await api('sendMessage', plain); }
    }
  }

  async function download(fileId) {
    const gf = await api('getFile', { file_id: fileId });
    const fp = gf?.result?.file_path;
    if (!fp) throw new Error('getFile başarısız');
    const r = await fetch(`https://api.telegram.org/file/bot${TG_TOKEN}/${fp}`);
    if (!r.ok) throw new Error(`indirme ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return { buf, mime: r.headers.get('content-type') || '', path: fp };
  }

  function ttsClean(t) {
    return (t || '').replace(/```[\s\S]*?```/g, '').replace(/[*_`#>]/g, '')
      .replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 900);
  }
  async function tts(text) {
    if (!ELEVEN_KEY || !ELEVEN_VOICE) return null;
    const clean = ttsClean(text);
    if (!clean) return null;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: clean, model_id: ELEVEN_MODEL || 'eleven_multilingual_v2', voice_settings: { stability: 0.4, similarity_boost: 0.85 } }),
    });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  }
  async function sendAudio(buf, chatId, caption) {
    const cid = chatId || TG_CHAT;
    if (!buf || !cid) return;
    const fd = new FormData();
    fd.append('chat_id', String(cid));
    if (caption) fd.append('caption', caption.slice(0, 1000));
    fd.append('audio', new Blob([buf], { type: 'audio/mpeg' }), 'xjarvis.mp3');
    fd.append('title', 'XJarvis');
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendAudio`, { method: 'POST', body: fd }).catch(() => {});
  }

  const DAILY_CMDS = {
    '/piyasa': () => daily.composeMarkets(), '/borsa': () => daily.composeMarkets(),
    '/haber': () => daily.composeNews(),
    '/namaz': () => daily.composePrayer(), '/ezan': () => daily.composePrayer(),
    '/ayet': () => Promise.resolve(daily.composeAyah()),
    '/hadis': () => Promise.resolve(daily.composeHadith()),
    '/motivasyon': () => Promise.resolve(daily.composeMotivation()),
    '/brief': () => daily.composeFull(), '/brifing': () => daily.composeFull(),
    '/tasavvuf': () => tasavvuf.composeTasavvuf(), '/gazali': () => tasavvuf.composeTasavvuf(),
    '/video': () => ytFeed.composeVideos(), '/youtube': () => ytFeed.composeVideos(),
    '/kitap': () => bookFeed.composeBooks(), '/kitaplar': () => bookFeed.composeBooks(),
    '/film': () => filmFeed.composeFilms(), '/filmler': () => filmFeed.composeFilms(),
  };
  const CB_MAP = { piyasa: '/piyasa', haber: '/haber', namaz: '/namaz', ayet: '/ayet', hadis: '/hadis', motivasyon: '/motivasyon', brief: '/brief' };

  const menuKeyboard = () => ({ inline_keyboard: [
    [{ text: '📊 Piyasa', callback_data: 'piyasa' }, { text: '📰 Haber', callback_data: 'haber' }],
    [{ text: '🕌 Namaz', callback_data: 'namaz' }, { text: '📖 Ayet', callback_data: 'ayet' }],
    [{ text: '☪️ Hadis', callback_data: 'hadis' }, { text: '💪 Motivasyon', callback_data: 'motivasyon' }],
    [{ text: '🗓️ Tam Brifing', callback_data: 'brief' }],
  ] });

  const HELP_TEXT = [
    '🤖 *XJarvis* emrinde Patron. Butonları kullan ya da yaz.',
    '',
    '*Komutlar:*',
    '/brief — Tam günlük brifing',
    '/piyasa — Borsa, döviz, altın, kripto',
    '/haber — Yapay zeka & teknoloji haberleri',
    '/namaz — Balıkesir namaz vakitleri + hicri',
    '/ayet — Günün ayeti', '/hadis — Günün hadisi', '/motivasyon — Günün sözü',
    '/status — Durum', '/menu — Buton menüsü',
    '',
    '🎙️ Sesli mesaj yollayabilirsin (yazıya çevirip hallederim).',
    '🖼️ Fotoğraf yollayabilirsin (ne olduğunu söylerim).',
  ].join('\n');

  async function runDailyCmd(cmd, chatId) {
    await api('sendChatAction', { chat_id: chatId || TG_CHAT, action: 'typing' });
    try { await send(await DAILY_CMDS[cmd](), chatId); }
    catch (e) { await send(`Veri alınamadı Patron: ${e.message}`, chatId); }
  }

  function writeTmp(buf, ext) {
    const dir = pth.join(os.tmpdir(), 'xjarvis-files');
    fss.mkdirSync(dir, { recursive: true });
    const p = pth.join(dir, `${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext || 'bin'}`);
    fss.writeFileSync(p, buf);
    return p;
  }
  function ffmpegToWav(srcPath) {
    return new Promise((resolve, reject) => {
      const out = srcPath + '.wav';
      cp.execFile('ffmpeg', ['-y', '-i', srcPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out],
        { timeout: 120_000 }, (err) => (err ? reject(err) : resolve(out)));
    });
  }

  async function voiceAnswerBuf(buf, mime, chatId) {
    let text = await transcribeGroq(buf, mime || 'audio/ogg');
    if (!text && transcribeDeepgram) text = await transcribeDeepgram(buf, mime || 'audio/ogg');
    if (!text) { await send('Sesini çözemedim Patron, bir daha dener misin?', chatId); return; }
    await send(`🎙️ _“${text}”_`, chatId);
    if (runServerAgent) {
      await api('sendChatAction', { chat_id: chatId, action: 'record_voice' });
      let reply = null;
      try { reply = await runServerAgent(text); } catch (e) { reply = null; }
      if (reply) {
        await send(reply, chatId);
        try { const mp3 = await tts(reply); if (mp3) await sendAudio(mp3, chatId); } catch (e) {}
        return;
      }
    }
    const id = enqueueCmd({ text, source: 'telegram' });
    await send(`Aldım Patron, hallediyorum… (\`${id}\`)`, chatId);
  }

  async function visionAnswerBuf(buf, mime, caption, chatId) {
    if (!anthropic) { await send('Görseli şu an yorumlayamıyorum Patron.', chatId); return; }
    const media = (mime && mime.startsWith('image/')) ? mime : 'image/jpeg';
    const resp = await anthropic.messages.create({
      model: AGENT_MODEL, max_tokens: 700, system: SYS_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } },
        { type: 'text', text: caption ? `Patron bu görseli gönderdi ve dedi ki: "${caption}". Görseli incele, Türkçe yanıtla.` : 'Patron bu görseli gönderdi. Ne görüyorsun? Türkçe, kısa ve net açıkla.' },
      ] }],
    });
    const out = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    await send(out || '(görseli yorumlayamadım)', chatId);
  }

  async function videoAnswerBuf(buf, mime, caption, chatId) {
    const ext = (mime && mime.includes('quicktime')) ? 'mov' : 'mp4';
    const p = writeTmp(buf, ext);
    try {
      const wav = await ffmpegToWav(p);
      const wbuf = fss.readFileSync(wav);
      try { fss.unlinkSync(p); fss.unlinkSync(wav); } catch (e) {}
      const text = await transcribeGroq(wbuf, 'audio/wav');
      if (!text) { await send('Videodan ses/metin çıkaramadım Patron.', chatId); return; }
      await send(`🎬 _Videodan: “${text.slice(0, 300)}${text.length > 300 ? '…' : ''}”_`, chatId);
      if (runServerAgent) {
        let reply = null;
        try { reply = await runServerAgent(`Patron bir video gönderdi. Konuşma metni:\n"""${text.slice(0, 8000)}"""\n${caption || 'Bunu özetle / yorumla.'}`); } catch (e) {}
        if (reply) { await send(reply, chatId); return; }
      }
      const id = enqueueCmd({ text: `[video] ${text.slice(0, 1500)}`, source: 'telegram' });
      await send(`Aldım Patron (\`${id}\`).`, chatId);
    } catch (e) {
      try { fss.unlinkSync(p); } catch (e2) {}
      await send(`Video işlenemedi: ${e.message}`, chatId);
    }
  }

  async function handleVoice(fileId, chatId) {
    await api('sendChatAction', { chat_id: chatId, action: 'typing' });
    const { buf, mime } = await download(fileId);
    await voiceAnswerBuf(buf, mime, chatId);
  }
  async function handlePhoto(fileId, caption, chatId) {
    await api('sendChatAction', { chat_id: chatId, action: 'typing' });
    const { buf, mime } = await download(fileId);
    await visionAnswerBuf(buf, mime, caption, chatId);
  }
  async function handleVideo(fileId, caption, chatId) {
    await api('sendChatAction', { chat_id: chatId, action: 'typing' });
    let dl;
    try { dl = await download(fileId); } catch (e) { await send('Videoyu indiremedim (Telegram 20MB sınırı olabilir Patron).', chatId); return; }
    await videoAnswerBuf(dl.buf, dl.mime, caption, chatId);
  }
  async function handleDocument(doc, caption, chatId) {
    await api('sendChatAction', { chat_id: chatId, action: 'typing' });
    const mime = (doc.mime_type || '').toLowerCase();
    const name = doc.file_name || 'dosya';
    let dl;
    try { dl = await download(doc.file_id); } catch (e) { await send('Dosyayı indiremedim (Telegram 20MB sınırı olabilir Patron).', chatId); return; }
    if (mime.startsWith('image/')) { await visionAnswerBuf(dl.buf, mime, caption, chatId); return; }
    if (mime.startsWith('audio/')) { await voiceAnswerBuf(dl.buf, mime, chatId); return; }
    if (mime.startsWith('video/')) { await videoAnswerBuf(dl.buf, mime, caption, chatId); return; }
    const p = writeTmp(dl.buf, (name.split('.').pop() || 'bin'));
    let text = '';
    try { text = await ingest.extractText(p, mime, name); }
    catch (e) { try { fss.unlinkSync(p); } catch (e2) {} await send(`"${name}" okunamadı: ${e.message}`, chatId); return; }
    try { fss.unlinkSync(p); } catch (e) {}
    if (!text.trim()) { await send(`"${name}" boş görünüyor.`, chatId); return; }
    await send(`📄 _"${name}" okundu (${text.length} karakter), özetliyorum…_`, chatId);
    const q = `Patron "${name}" dosyasını gönderdi. İçeriği:\n"""${text.slice(0, 12000)}"""\n\n${caption || 'Bu dosyayı özetle ve önemli noktaları çıkar.'}`;
    if (runServerAgent) {
      let reply = null;
      try { reply = await runServerAgent(q); } catch (e) {}
      if (reply) { await send(reply, chatId); return; }
    }
    const id = enqueueCmd({ text: q.slice(0, 1800), source: 'telegram' });
    await send(`"${name}" aldım, işliyorum (\`${id}\`).`, chatId);
  }

  async function handleUpdate(body) {
    const cq = body?.callback_query;
    if (cq) {
      const cid = String(cq.message?.chat?.id || '');
      await api('answerCallbackQuery', { callback_query_id: cq.id });
      if (!TG_CHAT || cid === TG_CHAT) { const cmd = CB_MAP[cq.data]; if (cmd) await runDailyCmd(cmd, cid); }
      return;
    }
    const msg = body?.message || body?.edited_message;
    if (!msg) return;
    const chatId = String(msg.chat?.id || '');
    if (TG_CHAT && chatId !== TG_CHAT) return;

    if (msg.voice || msg.audio) { await handleVoice((msg.voice || msg.audio).file_id, chatId); return; }
    if (msg.photo && msg.photo.length) { await handlePhoto(msg.photo[msg.photo.length - 1].file_id, (msg.caption || '').trim(), chatId); return; }
    if (msg.video || msg.video_note) { await handleVideo((msg.video || msg.video_note).file_id, (msg.caption || '').trim(), chatId); return; }
    if (msg.document) { await handleDocument(msg.document, (msg.caption || '').trim(), chatId); return; }

    const text = (msg.text || '').trim();
    if (!text) return;
    const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
    if (cmd === '/start' || cmd === '/help' || cmd === '/menu') {
      await api('sendMessage', { chat_id: chatId, text: HELP_TEXT, parse_mode: 'Markdown', reply_markup: menuKeyboard() });
      return;
    }
    if (cmd === '/status') { await send(`🩺 Bot ✅ çalışıyor. Kuyruk: ${pendingCount()} bekleyen.`, chatId); return; }
    if (DAILY_CMDS[cmd]) { await runDailyCmd(cmd, chatId); return; }

    if (runServerAgent) {
      await api('sendChatAction', { chat_id: chatId, action: 'typing' });
      let reply = null;
      try { reply = await runServerAgent(text); } catch (e) { reply = null; }
      if (reply) { await send(reply, chatId); return; }
    }
    const id = enqueueCmd({ text, source: 'telegram' });
    await send(`📥 Aldım Patron, hallediyorum… (\`${id}\`)`, chatId);
  }

  async function registerCommands() {
    await api('setMyCommands', { commands: [
      { command: 'brief', description: 'Tam günlük brifing' },
      { command: 'piyasa', description: 'Borsa, döviz, altın, kripto' },
      { command: 'haber', description: 'Yapay zeka & teknoloji haberleri' },
      { command: 'namaz', description: 'Balıkesir namaz vakitleri + hicri' },
      { command: 'ayet', description: 'Günün ayeti' },
      { command: 'hadis', description: 'Günün hadisi' },
      { command: 'motivasyon', description: 'Günün sözü' },
      { command: 'status', description: 'Durum' },
      { command: 'tasavvuf', description: 'Günün tasavvuf özeti' },
      { command: 'video', description: 'Günün video tavsiyeleri' },
      { command: 'kitap', description: 'Günün kitap tavsiyeleri' },
      { command: 'film', description: 'Günün film tavsiyeleri' },
      { command: 'menu', description: 'Buton menüsü' },
    ] });
  }

  async function sendDailyBrief() { await send(await daily.composeFull()); }

  // Çift/eksik gönderim koruması: her dakika çağrılır; 08:30'dan sonra, o gün
  // henüz gönderilmediyse bir kez gönderir. Başarı olunca işaretler (hata olursa
  // sonraki dakika tekrar dener). In-memory flag eş-zamanlı çift gönderimi keser.
  const BRIEF_HM = { h: 8, m: 30 };
  const BRIEF_MARK = pth.join(os.homedir(), '.xjarvis-daily-brief-last');
  let _sendingBrief = false;
  async function maybeSendDailyBrief() {
    if (_sendingBrief) return;
    const now = new Date(); // process TZ=Europe/Istanbul
    if (now.getHours() * 60 + now.getMinutes() < BRIEF_HM.h * 60 + BRIEF_HM.m) return;
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let last = '';
    try { last = fss.readFileSync(BRIEF_MARK, 'utf-8').trim(); } catch (e) {}
    if (last === today) return;
    _sendingBrief = true;
    try {
      await sendDailyBrief();
      fss.writeFileSync(BRIEF_MARK, today);
      console.log('[daily] sabah raporu gönderildi', today);
    } catch (e) {
      console.warn('[daily] gönderim hatası (sonraki dakika tekrar):', e.message);
    } finally { _sendingBrief = false; }
  }

  // Günlük tasavvuf özeti — 12:00, catch-up + çift-koruma (brief ile aynı mantık).
  const TAS_HM = { h: 12, m: 0 };
  const TAS_MARK = pth.join(os.homedir(), '.xjarvis-tasavvuf-last');
  let _sendingTas = false;
  async function sendTasavvuf() { await send(tasavvuf.composeTasavvuf()); }
  async function maybeSendTasavvuf() {
    if (_sendingTas) return;
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < TAS_HM.h * 60 + TAS_HM.m) return;
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let last = '';
    try { last = fss.readFileSync(TAS_MARK, 'utf-8').trim(); } catch (e) {}
    if (last === today) return;
    _sendingTas = true;
    try { await sendTasavvuf(); fss.writeFileSync(TAS_MARK, today); console.log('[tasavvuf] gönderildi', today); }
    catch (e) { console.warn('[tasavvuf] hata (sonraki dakika tekrar):', e.message); }
    finally { _sendingTas = false; }
  }

  // 11:00 — günün video tavsiyeleri
  const VID_HM = { h: 11, m: 0 };
  const VID_MARK = pth.join(os.homedir(), '.xjarvis-video-last');
  let _sendingVid = false;
  async function sendVideos() { await send(await ytFeed.composeVideos()); }
  async function maybeSendVideos() {
    if (_sendingVid) return;
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < VID_HM.h * 60 + VID_HM.m) return;
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let last = ''; try { last = fss.readFileSync(VID_MARK, 'utf-8').trim(); } catch (e) {}
    if (last === today) return;
    _sendingVid = true;
    try { await sendVideos(); fss.writeFileSync(VID_MARK, today); console.log('[video] gönderildi', today); }
    catch (e) { console.warn('[video] hata:', e.message); } finally { _sendingVid = false; }
  }

  // 15:00 — günün kitap tavsiyeleri
  const BOOK_HM = { h: 15, m: 0 };
  const BOOK_MARK = pth.join(os.homedir(), '.xjarvis-book-last');
  let _sendingBook = false;
  async function sendBooks() { await send(await bookFeed.composeBooks()); }
  async function maybeSendBooks() {
    if (_sendingBook) return;
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < BOOK_HM.h * 60 + BOOK_HM.m) return;
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let last = ''; try { last = fss.readFileSync(BOOK_MARK, 'utf-8').trim(); } catch (e) {}
    if (last === today) return;
    _sendingBook = true;
    try {
      const text = await bookFeed.composeBooks();
      if (/Kitap tavsiyesi alınamadı/.test(text)) return; // API hazır değil → gönderme/işaretleme, sonra dener
      await send(text); fss.writeFileSync(BOOK_MARK, today); console.log('[kitap] gönderildi', today);
    } catch (e) { console.warn('[kitap] hata:', e.message); } finally { _sendingBook = false; }
  }
  // 20:00 — gunun film tavsiyeleri (yasal)
  const FILM_HM = { h: 20, m: 0 };
  const FILM_MARK = pth.join(os.homedir(), '.xjarvis-film-last');
  let _sendingFilm = false;
  async function maybeSendFilms() {
    if (_sendingFilm) return;
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < FILM_HM.h * 60 + FILM_HM.m) return;
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let last = ''; try { last = fss.readFileSync(FILM_MARK, 'utf-8').trim(); } catch (e) {}
    if (last === today) return;
    _sendingFilm = true;
    try {
      const text = await filmFeed.composeFilms();
      if (/TMDB_API_KEY gerekli|alınamadı|bulunamadı/.test(text)) return;
      await send(text); fss.writeFileSync(FILM_MARK, today); console.log('[film] gonderildi', today);
    } catch (e) { console.warn('[film] hata:', e.message); } finally { _sendingFilm = false; }
  }

  return { handleUpdate, registerCommands, sendDailyBrief, maybeSendDailyBrief, sendTasavvuf, maybeSendTasavvuf, maybeSendVideos, maybeSendBooks, maybeSendFilms };
};
