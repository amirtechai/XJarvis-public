require('dotenv').config({ path: __dirname + '/.env' });
const http = require('http');
const { WebSocketServer } = require('ws');
const { routeMessage } = require('./router');
const { bus } = require('./events/bus');
const { EVENT_TYPES } = require('./events/types');
const { handleHttp: handleStats, startBroadcast: startStatsBroadcast } = require('./system_stats');
const { handleHttp: handleSetup } = require('./setup');
const { handleHttp: handleControl } = require('./control');
const { handleHttp: handleMcp } = require('./mcp');
const { handleHttp: handleSkills } = require('./skills');
const { handleHttp: handlePermissions } = require('./permissions');
const { handleHttp: handleTelegram, start: startTelegram, sendMdToAllowlist: tgSendMd } = require('./telegram');
const serverBridge = require('./server-bridge');
const { handleHttp: handleSystemUtils, shouldHandle: isSystemUtils } = require('./system-utils');
const { handleHttp: handleWake, shouldHandle: isWake } = require('./wake');
const { handleHttp: handleHealth, shouldHandle: isHealth } = require('./health');
const { handleHttp: handleCrash, shouldHandle: isCrash } = require('./crash-report');
const whatsapp = require('./whatsapp');
const finance = require('./finance');
const markets = require('./markets');
const costWatcher = require('./cost-watcher');
const nowPlaying = require('./now-playing');
const whoop = require('./whoop');
const remindersWatcher = require('./reminders-watcher');
const morningBrief = require('./morning-brief');
const dailyBrief = require('./daily-brief');
const meetingDetector = require('./meeting-detector');
const meetingBrief = require('./meeting-brief');
const insights = require('./insights');
const heartbeat = require('./heartbeat');
const goals = require('./goals');
const sync = require('./sync');
const skillGen = require('./skill-gen');
const screenAwareness = require('./screen-awareness');
const emailDrafts = require('./email-drafts');
const workflows = require('./workflows');
const agentAsk = require('./agent-ask');
const agentModel = require('./agent-model');
const newsExtra = require('./news-extra');
const googleOauth = require('./google-oauth');
const googleServices = require('./google-services');
const spotifyOauth = require('./spotify-oauth');
const atlassian = require('./atlassian');
const falCreative = require('./fal-creative');
const devFeed = require('./dev-feed');
const episodicMemory = require('./episodic-memory');
const userProfile = require('./user-profile');
const conversationCompress = require('./conversation-compress');
const patterns = require('./patterns');
const quickCapture = require('./quick-capture');
const plans = require('./plans');
const multiAgent = require('./multi-agent');
const webMonitor = require('./web-monitor');
const fileOrganize = require('./file-organize');
const newsFeed = require('./news-feed');
const readLater = require('./read-later');
const anki = require('./anki');
const windowManage = require('./window-manage');
const multimedia = require('./multimedia');
const notion = require('./notion');
const appControl = require('./app-control');
const voiceConfig = require('./voice-config');
const servicesControl = require('./services-control');
const youtubeLive = require('./youtube-live');
const monitors = require('./monitors');
const agentsRuns = require('./agents-runs');
const tools = require('./tools-timeline');
const research = require('./research');
const briefingFx = require('./briefing-fx');
const personas = require('./personas');
const knowledge = require('./knowledge');
const computerUse = require('./computer-use');
const visionDetect = require('./vision-detect');
const commandQueue = require('./command-queue');
const replayBuffer = require('./replay-buffer');
const calendarPrep = require('./calendar-prep');
const inboxUnified = require('./inbox-unified');
const emotionTone = require('./emotion-tone');
const autoUpdate = require('./auto-update');
const podcastStudio = require('./podcast-studio');
const inboxSweeper = require('./inbox-sweeper');
const { attachTTSBridge } = require('./tts_bridge');
const bgStatic = require('./bg-static');

const PORT = Number(process.env.PORT) || 3001;  // OVH deploy'u backend/.env'den PORT=3020 alır

// CORS allowlist (BULGU 1 fix) — önceden herhangi bir origin yansıtılıyordu
// (auth yok), kötü niyetli bir web sayfası localhost:3001'e DNS-rebinding/
// CSRF ile agent/kontrol endpoint'lerini çağırabiliyordu. Şimdi sadece
// bilinen istemcilere izin veriliyor; Tauri webview origin'i mutlaka geçmeli.
// Uzak web deploy için kendi origin'ini COMPANION_ORIGIN env'i ile ekle
// (ör. COMPANION_ORIGIN=https://xjarvis.senin-alanadin.com).
const ALLOWED_ORIGINS = new Set([
  'tauri://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:1420', // tauri dev
  ...(process.env.COMPANION_ORIGIN ? [process.env.COMPANION_ORIGIN] : []),
]);
function isAllowedOrigin(origin) {
  return !!origin && ALLOWED_ORIGINS.has(origin);
}
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
}

// Fail-safe: a transient network/DNS error in any background service (Google
// OAuth refresh, news feeds, etc.) must NEVER take down the whole backend.
// Log and keep serving — agent routing, navigation and WS stay alive.
const SURVIVABLE = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET',
  'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH',
]);
function logFatal(kind, err) {
  const code = err && err.code;
  const stamp = new Date().toISOString();
  console.error(`[backend] ${stamp} ${kind}${code ? ` (${code})` : ''}: ${err && err.stack ? err.stack : err}`);
}
process.on('unhandledRejection', (err) => {
  logFatal('unhandledRejection — survived', err);
});
process.on('uncaughtException', (err) => {
  logFatal('uncaughtException', err);
  // Only keep running for known-transient network errors; for anything else
  // exit so launchd can restart cleanly (process state may be undefined).
  if (!err || !SURVIVABLE.has(err.code)) {
    console.error('[backend] non-survivable — exiting for clean restart');
    process.exit(1);
  }
  console.error('[backend] transient network error — staying up');
});

const uploadMod = require('./upload');

// --- GÜVENLİK: uzaktan kod çalıştırma (RCE) koruması ---
// Backend exec/agent/kontrol route'ları taşır (osascript, spawn, Agent SDK).
// 2026-07 olayında bu route'lar auth'suz internete açıktı → madenci damlatıldı.
// İki katmanlı kök koruma:
//   1) server yalnız 127.0.0.1'e bağlanır (server.listen aşağıda) → ağdan
//      DOĞRUDAN erişilemez; yalnızca aynı-host nginx (basic-auth) proxy'ler.
//   2) XJARVIS_EXEC_TOKEN set ise, exec route'ları geçerli 'x-jarvis-token'
//      (veya 'Authorization: Bearer') ister; yoksa 401. Token yoksa gate KAPALI
//      (yerel Mac dev kırılmaz; ağ koruması yine 127.0.0.1 binding).
const EXEC_TOKEN = process.env.XJARVIS_EXEC_TOKEN || '';
function isExecRoute(url) {
  if (!url) return false;
  if (/^\/api\/(setup|control|agent|mcp|skills|permissions|telegram)\b/i.test(url)) return true;
  const check = (m) => { try { return !!(m && m.shouldHandle && m.shouldHandle(url)); } catch (_) { return false; } };
  try { if (typeof isSystemUtils === 'function' && isSystemUtils(url)) return true; } catch (_) {}
  return check(skillGen) || check(multiAgent) || check(appControl) ||
         check(servicesControl) || check(agentsRuns) || check(computerUse) ||
         check(commandQueue) || check(tools) || check(workflows) ||
         check(fileOrganize) || check(windowManage);
}
function passExecAuth(req, res) {
  if (!EXEC_TOKEN) return true;            // token set değil → gate kapalı
  if (!isExecRoute(req.url)) return true;  // exec route değil → serbest
  const h = req.headers || {};
  const tok = h['x-jarvis-token'] || String(h.authorization || '').replace(/^Bearer\s+/i, '');
  if (tok && tok === EXEC_TOKEN) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'unauthorized: exec route requires token' }));
  return false;
}

const server = http.createServer(async (req, res) => {
  if (bgStatic.shouldHandle(req.url)) return bgStatic.handle(req, res);
  // Dosya yükleme (chatbox ekleri) — ham bayt POST → yerel path + önişleme
  if (uploadMod.shouldHandle(req.url)) {
    applyCors(req, res);
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, *');
    // Görsel/video/pdf gövdesi binary Content-Type taşır → tarayıcı preflight yapar.
    // OPTIONS'a 204 + CORS header dön ki asıl POST gönderilsin.
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'POST') return uploadMod.handle(req, res);
  }
  if (req.url === '/api/system-stats') {
    return handleStats(req, res);
  }
  // In-app navigation broadcast — agent's xjarvis_page tool POSTs here so
  // the active Tauri webview can router.push() without opening Safari tabs.
  if (req.url === '/api/nav/goto' && req.method === 'POST') {
    applyCors(req, res);
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const { route } = JSON.parse(body || '{}');
        if (typeof route !== 'string' || !route.startsWith('/')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'route must start with /' }));
        }
        bus.emit(EVENT_TYPES.NAVIGATE, { route, source: 'agent' }, 'system');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, route }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }
  if (req.url && (
    req.url.startsWith('/api/setup/') ||
    req.url.startsWith('/api/control/') ||
    req.url.startsWith('/api/agent/') ||
    req.url.startsWith('/api/mcp/') ||
    req.url.startsWith('/api/skills') ||
    req.url.startsWith('/api/permissions') ||
    req.url.startsWith('/api/telegram') ||
    isSystemUtils(req.url) ||
    isWake(req.url) ||
    isHealth(req.url) ||
    isCrash(req.url) ||
    whatsapp.shouldHandle(req.url) ||
    finance.shouldHandle(req.url) ||
    markets.shouldHandle(req.url) ||
    dailyBrief.shouldHandle(req.url) ||
    nowPlaying.shouldHandle(req.url) ||
    whoop.shouldHandle(req.url) ||
    meetingBrief.shouldHandle(req.url) ||
    insights.shouldHandle(req.url) ||
    heartbeat.shouldHandle(req.url) ||
    goals.shouldHandle(req.url) ||
    sync.shouldHandle(req.url) ||
    skillGen.shouldHandle(req.url) ||
    screenAwareness.shouldHandle(req.url) ||
    emailDrafts.shouldHandle(req.url) ||
    workflows.shouldHandle(req.url) ||
    episodicMemory.shouldHandle(req.url) ||
    userProfile.shouldHandle(req.url) ||
    conversationCompress.shouldHandle(req.url) ||
    patterns.shouldHandle(req.url) ||
    quickCapture.shouldHandle(req.url) ||
    plans.shouldHandle(req.url) ||
    multiAgent.shouldHandle(req.url) ||
    webMonitor.shouldHandle(req.url) ||
    fileOrganize.shouldHandle(req.url) ||
    newsFeed.shouldHandle(req.url) ||
    readLater.shouldHandle(req.url) ||
    anki.shouldHandle(req.url) ||
    windowManage.shouldHandle(req.url) ||
    multimedia.shouldHandle(req.url) ||
    notion.shouldHandle(req.url) ||
    appControl.shouldHandle(req.url) ||
    voiceConfig.shouldHandle(req.url) ||
    servicesControl.shouldHandle(req.url) ||
    youtubeLive.shouldHandle(req.url) ||
    monitors.shouldHandle(req.url) ||
    agentsRuns.shouldHandle(req.url) ||
    tools.shouldHandle(req.url) ||
    research.shouldHandle(req.url) ||
    briefingFx.shouldHandle(req.url) ||
    personas.shouldHandle(req.url) ||
    knowledge.shouldHandle(req.url) ||
    computerUse.shouldHandle(req.url) ||
    visionDetect.shouldHandle(req.url) ||
    commandQueue.shouldHandle(req.url) ||
    costWatcher.shouldHandle(req.url) ||
    replayBuffer.shouldHandle(req.url) ||
    calendarPrep.shouldHandle(req.url) ||
    inboxUnified.shouldHandle(req.url) ||
    emotionTone.shouldHandle(req.url) ||
    autoUpdate.shouldHandle(req.url) ||
    podcastStudio.shouldHandle(req.url) ||
    agentModel.shouldHandle(req.url) ||
    newsExtra.shouldHandle(req.url) ||
    googleOauth.shouldHandle(req.url) ||
    googleServices.shouldHandle(req.url) ||
    spotifyOauth.shouldHandle(req.url) ||
    atlassian.shouldHandle(req.url) ||
    falCreative.shouldHandle(req.url) ||
    devFeed.shouldHandle(req.url)
  )) {
    applyCors(req, res);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!passExecAuth(req, res)) return;   // GÜVENLİK: exec route'ları token ister (RCE koruması)
    const handler =
      req.url.startsWith('/api/setup/')       ? handleSetup :
      req.url.startsWith('/api/mcp/')         ? handleMcp :
      skillGen.shouldHandle(req.url)          ? skillGen.handleHttp :
      req.url.startsWith('/api/skills')       ? handleSkills :
      req.url.startsWith('/api/permissions')  ? handlePermissions :
      req.url.startsWith('/api/telegram')     ? handleTelegram :
      isSystemUtils(req.url)                  ? handleSystemUtils :
      isWake(req.url)                         ? handleWake :
      isHealth(req.url)                       ? handleHealth :
      isCrash(req.url)                        ? handleCrash :
      whatsapp.shouldHandle(req.url)          ? whatsapp.handleHttp :
      finance.shouldHandle(req.url)           ? finance.handleHttp :
      newsExtra.shouldHandle(req.url)         ? newsExtra.handleHttp :
      markets.shouldHandle(req.url)           ? markets.handleHttp :
      dailyBrief.shouldHandle(req.url)        ? (rq, rs) => dailyBrief.handleHttp(rq, rs, tgSendMd) :
      nowPlaying.shouldHandle(req.url)        ? nowPlaying.handleHttp :
      whoop.shouldHandle(req.url)             ? whoop.handleHttp :
      meetingBrief.shouldHandle(req.url)      ? meetingBrief.handleHttp :
      insights.shouldHandle(req.url)          ? insights.handleHttp :
      heartbeat.shouldHandle(req.url)         ? heartbeat.handleHttp :
      goals.shouldHandle(req.url)             ? goals.handleHttp :
      sync.shouldHandle(req.url)              ? sync.handleHttp :
      screenAwareness.shouldHandle(req.url)   ? screenAwareness.handleHttp :
      emailDrafts.shouldHandle(req.url)       ? emailDrafts.handleHttp :
      workflows.shouldHandle(req.url)         ? workflows.handleHttp :
      agentAsk.shouldHandle(req.url)          ? agentAsk.handleHttp :
      episodicMemory.shouldHandle(req.url)    ? episodicMemory.handleHttp :
      userProfile.shouldHandle(req.url)       ? userProfile.handleHttp :
      conversationCompress.shouldHandle(req.url) ? conversationCompress.handleHttp :
      patterns.shouldHandle(req.url)          ? patterns.handleHttp :
      quickCapture.shouldHandle(req.url)      ? quickCapture.handleHttp :
      plans.shouldHandle(req.url)             ? plans.handleHttp :
      multiAgent.shouldHandle(req.url)        ? multiAgent.handleHttp :
      webMonitor.shouldHandle(req.url)        ? webMonitor.handleHttp :
      fileOrganize.shouldHandle(req.url)      ? fileOrganize.handleHttp :
      newsFeed.shouldHandle(req.url)          ? newsFeed.handleHttp :
      readLater.shouldHandle(req.url)         ? readLater.handleHttp :
      anki.shouldHandle(req.url)              ? anki.handleHttp :
      windowManage.shouldHandle(req.url)      ? windowManage.handleHttp :
      multimedia.shouldHandle(req.url)        ? multimedia.handleHttp :
      notion.shouldHandle(req.url)            ? notion.handleHttp :
      appControl.shouldHandle(req.url)        ? appControl.handleHttp :
      voiceConfig.shouldHandle(req.url)       ? voiceConfig.handleHttp :
      servicesControl.shouldHandle(req.url)   ? servicesControl.handleHttp :
      youtubeLive.shouldHandle(req.url)       ? youtubeLive.handleHttp :
      monitors.shouldHandle(req.url)          ? monitors.handleHttp :
      agentsRuns.shouldHandle(req.url)        ? agentsRuns.handleHttp :
      tools.shouldHandle(req.url)             ? tools.handleHttp :
      research.shouldHandle(req.url)          ? research.handleHttp :
      briefingFx.shouldHandle(req.url)        ? briefingFx.handleHttp :
      personas.shouldHandle(req.url)          ? personas.handleHttp :
      knowledge.shouldHandle(req.url)         ? knowledge.handleHttp :
      computerUse.shouldHandle(req.url)       ? computerUse.handleHttp :
      visionDetect.shouldHandle(req.url)      ? visionDetect.handleHttp :
      commandQueue.shouldHandle(req.url)      ? commandQueue.handleHttp :
      costWatcher.shouldHandle(req.url)       ? costWatcher.handleHttp :
      replayBuffer.shouldHandle(req.url)      ? replayBuffer.handleHttp :
      calendarPrep.shouldHandle(req.url)      ? calendarPrep.handleHttp :
      inboxUnified.shouldHandle(req.url)      ? inboxUnified.handleHttp :
      emotionTone.shouldHandle(req.url)       ? emotionTone.handleHttp :
      autoUpdate.shouldHandle(req.url)        ? autoUpdate.handleHttp :
      podcastStudio.shouldHandle(req.url)     ? podcastStudio.handleHttp :
      newsExtra.shouldHandle(req.url)         ? newsExtra.handleHttp :
      agentModel.shouldHandle(req.url)        ? agentModel.handleHttp :
      googleOauth.shouldHandle(req.url)       ? googleOauth.handleHttp :
      googleServices.shouldHandle(req.url)    ? googleServices.handleHttp :
      spotifyOauth.shouldHandle(req.url)      ? spotifyOauth.handleHttp :
      atlassian.shouldHandle(req.url)         ? atlassian.handleHttp :
      falCreative.shouldHandle(req.url)       ? falCreative.handleHttp :
      devFeed.shouldHandle(req.url)           ? devFeed.handleHttp :
      newsExtra.shouldHandle(req.url)         ? newsExtra.handleHttp :
      handleControl;
    const handled = await handler(req, res);
    if (handled !== null && handled !== undefined) return;
    if (handled === undefined) return;
    if (handled === null) return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html><head><title>Jarvis Backend</title>
<style>body{background:#000a14;color:#00d4ff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
h1{letter-spacing:8px;font-size:2rem;text-shadow:0 0 20px #00d4ff;}</style></head>
<body><div><h1>J·A·R·V·I·S</h1><p style="text-align:center;opacity:.6;letter-spacing:2px">BACKEND ONLINE · ws://localhost:${PORT}</p></div></body></html>`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  bus.registerClient(ws);

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    if (msg.type === 'subscribe') {
      bus.setSubscriptions(ws, Array.isArray(msg.events) ? msg.events : []);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'subscribed', events: msg.events ?? [] }));
      return;
    }

    if (msg.type === 'unsubscribe') {
      bus.setSubscriptions(ws, []);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'unsubscribed' }));
      return;
    }

    if (msg.type === 'bus_emit' && typeof msg.event === 'string') {
      bus.emit(msg.event, msg.payload ?? {}, msg.source ?? 'system');
      return;
    }

    try {
      await routeMessage(msg, ws);
    } catch (err) {
      console.error('[ws] route error:', err.message);
      try { ws.send(JSON.stringify({ type: 'error', message: 'İstek başarısız: ' + err.message })); } catch {}
      try { ws.send(JSON.stringify({ type: 'stream_end' })); } catch {}
    }
  });

  ws.on('close', () => {
    bus.unregisterClient(ws);
    console.log('[ws] client disconnected');
  });
  ws.on('error', (err) => console.error('[ws] error:', err.message));
});

const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';  // GÜVENLİK: yalnız localhost — ağdan doğrudan erişilemez (nginx proxy'ler)
const IS_MAC = process.platform === 'darwin';  // Linux (OVH) deploy'unda macOS-veri watcher'ları başlatılmaz
server.listen(PORT, BIND_HOST, () => {
  console.log(`Jarvis backend running on http://${BIND_HOST}:${PORT} + ws://${BIND_HOST}:${PORT}${IS_MAC ? '' : ' (linux: mac-only watchers kapalı)'}`);
  startStatsBroadcast(5000);
  attachTTSBridge();
  startTelegram();
  serverBridge.start();
  if (IS_MAC) remindersWatcher.start();  // macOS Hatırlatıcılar
  morningBrief.start();
  if (IS_MAC) meetingDetector.start();   // macOS Takvim
  if (IS_MAC) meetingBrief.start();      // macOS Takvim
  insights.start();
  heartbeat.start();
  sync.start();
  if (IS_MAC) screenAwareness.start();   // macOS ekran görüntüsü
  workflows.start();
  episodicMemory.start();
  patterns.start();
  plans.start();
  webMonitor.start();
  fileOrganize.start();
  if (IS_MAC) inboxSweeper.start();      // macOS Mail
  if (process.env.XJARVIS_WA_DISABLED !== '1') whatsapp.start();  // OVH'de pasif (oturum Mac'te)
  finance.start();
  costWatcher.start();
  replayBuffer.start();
  googleOauth.startRefreshLoop();
  spotifyOauth.startRefreshLoop();
});
