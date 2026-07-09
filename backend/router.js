const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const { streamOllama } = require('./ollama');
const { executeAction } = require('./actions');
const { executeRemoteAction, listServers } = require('./ssh');
const { getConnectors, syncConnector, getModelRules, saveModelRules, getServers, saveServers } = require('./settings');
const { bus, EVENT_TYPES } = require('./events/bus');
const { enrichWithVision } = require('./vision_bridge');
const { streamXJarvis, isAgentUp } = require('./xjarvis_agent');
const { tryRoute: tryFastRoute } = require('./voice-router');
const conversationPause = require('./conversation-pause');

const DEFAULT_MODEL = 'gemma-4-e4b:latest';
const OPENJARVIS_ASK = path.join(__dirname, 'openjarvis_ask.py');

function selectModel(text) {
  const rules = getModelRules();
  for (const rule of rules) {
    try {
      const re = new RegExp(rule.pattern, rule.flags ?? 'i');
      if (re.test(text)) return rule.model;
    } catch {
      // skip malformed patterns
    }
  }
  return DEFAULT_MODEL;
}

function streamOpenJarvis(prompt, ws) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [OPENJARVIS_ASK, prompt], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    const rl = readline.createInterface({ input: proc.stdout });
    let gotOutput = false;

    let started = false;
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.err) {
          reject(new Error(msg.err));
          proc.kill();
          return;
        }
        if (msg.t) {
          if (!started) {
            started = true;
            bus.emit(EVENT_TYPES.RESPONSE_START, {}, 'system');
          }
          gotOutput = true;
          ws.send(JSON.stringify({ type: 'stream_chunk', content: msg.t }));
          bus.emit(EVENT_TYPES.RESPONSE_CHUNK, { text: msg.t }, 'system');
        }
        if (msg.done) {
          ws.send(JSON.stringify({ type: 'stream_end' }));
          bus.emit(EVENT_TYPES.RESPONSE_END, {}, 'system');
          resolve();
        }
      } catch {
        // skip unparseable lines
      }
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (!gotOutput && code !== 0) reject(new Error(`openjarvis_ask exited ${code}`));
      else resolve();
    });

    setTimeout(() => {
      proc.kill();
      reject(new Error('OpenJarvis timeout'));
    }, 60000);
  });
}

// Jarvis master state — flipped by /jarvis/toggle (Tauri tray)
let _jarvisOn = true;
function setJarvisOn(v) { _jarvisOn = !!v; }
function isJarvisOn() { return _jarvisOn; }

async function routeMessage(msg, ws) {
  if (msg.type === 'chat_message' || msg.type === 'voice_input') {
    if (!_jarvisOn) {
      ws.send(JSON.stringify({ type: 'stream_chunk', content: '[XJarvis kapalı — menü çubuğundan açın.]' }));
      ws.send(JSON.stringify({ type: 'stream_end' }));
      return;
    }
    let content = msg.content ?? '';

    // Pause/resume interception — handled before vision enrich + LLM
    const intercept = conversationPause.intercept(content, ws);
    if (intercept?.drop) {
      bus.emit(EVENT_TYPES.QUERY_RECEIVED, { text: content, channel: msg.type, intent: 'pause' }, 'user');
      return;
    }
    if (intercept?.rewrite) {
      content = intercept.rewrite;
    }
    bus.emit(EVENT_TYPES.QUERY_RECEIVED, { text: content, channel: msg.type }, 'user');
    conversationPause.noteAgentQuery(content);

    // FAST PATH — sık sesli komutlar (kamera, ses, saat vs.) LLM'siz cevaplansın
    if (msg.type === 'voice_input') {
      try {
        const fast = await tryFastRoute(content);
        if (fast?.handled) {
          console.log(`[fast-route] matched: ${fast.matched} → ${fast.reply}`);
          ws.send(JSON.stringify({ type: 'model_selected', model: 'fast-route' }));
          bus.emit(EVENT_TYPES.RESPONSE_START, {}, 'system');
          ws.send(JSON.stringify({ type: 'stream_chunk', content: fast.reply }));
          bus.emit(EVENT_TYPES.RESPONSE_CHUNK, { text: fast.reply }, 'system');
          ws.send(JSON.stringify({ type: 'stream_end' }));
          bus.emit(EVENT_TYPES.RESPONSE_END, {}, 'system');
          return;
        }
      } catch (err) {
        console.warn('[fast-route] error, falling through to LLM:', err.message);
      }
    }

    let finalQuery = content;
    try {
      const enriched = await enrichWithVision(content);
      finalQuery = enriched.query;
    } catch (err) {
      console.warn('[router] vision enrich failed:', err.message);
    }

    // Sesli komut → kısa, düz konuşma metni iste. Yazılı sohbet → normal cevap.
    if (msg.type === 'voice_input') {
      const voiceLang = (process.env.XJARVIS_LANG || 'tr').toLowerCase();
      const voiceInstruction = voiceLang === 'tr'
        ? 'SADECE Türkçe cevap ver, maksimum 20 kelime, 1-2 cümle, sohbet havasında. Liste, başlık, kod yazma.'
        : 'Reply in English, max 20 words, 1-2 sentences, plain spoken style. No bullets, no headers, no code.';
      finalQuery = `[VOICE_MODE: ${voiceInstruction}]\n\n${finalQuery}`;
    }

    // Priority: XJarvis agent → OpenJarvis subprocess → Ollama
    // NOT: Model SABİT (Sonnet) tutulur — Claude SDK kalıcı oturumu tek modeli
    // sıcak tutar; model değiştirmek oturumu reconnect ettirip YAVAŞLATIR
    // (ölçüldü: warm Sonnet 1.3-2.2s vs model-switch Haiku 3-5s). Hibrit kaldırıldı.
    if (await isAgentUp()) {
      try {
        await streamXJarvis(finalQuery, ws, Array.isArray(msg.files) ? msg.files : []);
        return;
      } catch (err) {
        console.warn('[router] xjarvis failed, falling back:', err.message);
      }
    }

    try {
      ws.send(JSON.stringify({ type: 'model_selected', model: 'openjarvis' }));
      await streamOpenJarvis(finalQuery, ws);
    } catch {
      const model = selectModel(finalQuery);
      ws.send(JSON.stringify({ type: 'model_selected', model }));
      await streamOllama(finalQuery, model, ws);
    }
    return;
  }

  if (msg.type === 'vision_request') {
    bus.emit(EVENT_TYPES.VISION_TRIGGERED, { query: msg.query ?? 'Bu görselde ne var?' }, 'user');
    return;
  }

  if (msg.type === 'action') {
    await executeAction(msg, ws);
    return;
  }

  if (msg.type === 'remote_action') {
    await executeRemoteAction(msg, ws);
    return;
  }

  if (msg.type === 'list_servers') {
    listServers(ws);
    return;
  }

  if (msg.type === 'get_connectors') {
    await getConnectors(ws);
    return;
  }

  if (msg.type === 'sync_connector') {
    await syncConnector(msg.name ?? '', ws);
    return;
  }

  if (msg.type === 'get_settings') {
    ws.send(JSON.stringify({
      type: 'settings',
      modelRules: getModelRules(),
      servers: getServers(),
    }));
    return;
  }

  if (msg.type === 'save_model_rules') {
    saveModelRules(msg.rules ?? []);
    ws.send(JSON.stringify({ type: 'settings_saved' }));
    return;
  }

  if (msg.type === 'save_servers') {
    saveServers(msg.servers ?? []);
    ws.send(JSON.stringify({ type: 'settings_saved' }));
    return;
  }

  ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
}

module.exports = { routeMessage, selectModel, setJarvisOn, isJarvisOn };
