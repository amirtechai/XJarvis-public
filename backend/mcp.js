/**
 * MCP server presets — read/write ~/.config/xjarvis/mcp.json (Claude Desktop format).
 *
 *   GET  /api/mcp/presets   → list of installable presets
 *   GET  /api/mcp/installed → current mcp.json contents
 *   POST /api/mcp/install   { name, env? }   ← writes preset into mcp.json
 *   POST /api/mcp/uninstall { name }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const MCP_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'mcp.json');

// Curated preset library. Each entry follows Claude Desktop MCP server format.
const PRESETS = [
  {
    id: 'filesystem',
    label: 'Filesystem',
    description: 'Yerel dosya sistemine güvenli erişim (belirtilen klasörler).',
    requires_env: [],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', os.homedir()],
    },
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Issue, PR, repo operasyonları. GITHUB_TOKEN gerekli.',
    requires_env: ['GITHUB_TOKEN'],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {},
    },
  },
  {
    id: 'memory',
    label: 'Memory (Knowledge Graph)',
    description: 'Kalıcı kavram-ilişki grafı — kişiler, projeler, fikirler.',
    requires_env: [],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
  },
  {
    id: 'fetch',
    label: 'Fetch',
    description: 'URL içerik çekme (HTML → markdown). Hızlı web research için.',
    requires_env: [],
    config_template: {
      command: 'uvx',
      args: ['mcp-server-fetch'],
    },
  },
  {
    id: 'time',
    label: 'Time & Timezones',
    description: 'Zaman dilimleri arası dönüşüm + sezgisel tarih hesaplamaları.',
    requires_env: [],
    config_template: {
      command: 'uvx',
      args: ['mcp-server-time'],
    },
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Slack mesajları okuma/gönderme. SLACK_BOT_TOKEN gerekli.',
    requires_env: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {},
    },
  },
  {
    id: 'puppeteer',
    label: 'Browser (Puppeteer)',
    description: 'Chrome ile sayfa açma, screenshot, form doldurma.',
    requires_env: [],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  },
  {
    id: 'playwright',
    label: 'Browser (Playwright)',
    description: 'Daha güvenli/headless tarayıcı kontrolü, Microsoft tarafından.',
    requires_env: [],
    config_template: {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
    },
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Issue, project, cycle, comment yönetimi. LINEAR_API_KEY gerekli.',
    requires_env: ['LINEAR_API_KEY'],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-linear'],
      env: {},
    },
  },
  {
    id: 'atlassian',
    label: 'Jira / Confluence',
    description: 'Atlassian Cloud — Jira issue + Confluence page CRUD.',
    requires_env: ['ATLASSIAN_CLOUD_URL', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN'],
    config_template: {
      command: 'npx',
      args: ['-y', 'mcp-atlassian'],
      env: {},
    },
  },
  {
    id: 'supabase',
    label: 'Supabase',
    description: 'Postgres tablo yönetimi, edge function, auth, storage.',
    requires_env: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    config_template: {
      command: 'npx',
      args: ['-y', '@supabase/mcp-server-supabase'],
      env: {},
    },
  },
  {
    id: 'spotify',
    label: 'Spotify',
    description: 'Müzik kontrolü — playlist, search, player. Spotify Premium gerekli.',
    requires_env: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-spotify'],
      env: {},
    },
  },
  {
    id: 'sentry',
    label: 'Sentry',
    description: 'Error tracking — issue listesi, event detay, release management.',
    requires_env: ['SENTRY_AUTH_TOKEN'],
    config_template: {
      command: 'npx',
      args: ['-y', '@sentry/mcp-server'],
      env: {},
    },
  },
  {
    id: 'context7',
    label: 'Context7 — Live Docs',
    description: 'React, Next.js, Tailwind vs. en güncel dokümanlar — hallucination zero.',
    requires_env: [],
    config_template: {
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    },
  },
  {
    id: 'sequential-thinking',
    label: 'Sequential Thinking',
    description: 'Anthropic\'in yapısal düşünme MCP\'si — karmaşık problemde adım adım.',
    requires_env: [],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
  },
  {
    id: 'sqlite',
    label: 'SQLite',
    description: 'Yerel SQLite db sorguları + DDL.',
    requires_env: [],
    config_template: {
      command: 'uvx',
      args: ['mcp-server-sqlite', '--db-path', `${require('os').homedir()}/.config/xjarvis/sqlite-mcp.db`],
    },
  },
  {
    id: 'gmail',
    label: 'Gmail',
    description: 'Mail okuma, taslak, etiket, gönderme — Google OAuth.',
    requires_env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    config_template: {
      command: 'npx',
      args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
      env: {},
    },
  },
  {
    id: 'apple-shortcuts',
    label: 'Apple Shortcuts',
    description: 'macOS Shortcuts.app uygulamalarını çağır — sistem entegrasyonu.',
    requires_env: [],
    config_template: {
      command: 'npx',
      args: ['-y', 'apple-shortcuts-mcp'],
    },
  },
  {
    id: 'notion-mcp',
    label: 'Notion (resmi MCP)',
    description: 'Notion\'ın resmi MCP\'si — page/db CRUD + embed search.',
    requires_env: ['NOTION_API_KEY'],
    config_template: {
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: {},
    },
  },
  {
    id: 'homekit',
    label: 'HomeKit (Apple)',
    description: 'Akıllı ev — lamba, termostat, perde, kapı kontrolü. macOS Home.app.',
    requires_env: [],
    config_template: {
      command: 'npx',
      args: ['-y', 'homebridge-mcp-bridge'],
    },
  },
  {
    id: 'philips-hue',
    label: 'Philips Hue',
    description: 'Hue bridge ile akıllı aydınlatma — sahne, renk, zamanlama.',
    requires_env: ['HUE_BRIDGE_IP', 'HUE_API_KEY'],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-hue'],
      env: {},
    },
  },
  {
    id: 'dji-drone',
    label: 'DJI Drone',
    description: 'DJI Mavic/Air SDK — takeoff, fly to coords, photo/video, return-home.',
    requires_env: ['DJI_APP_KEY'],
    config_template: {
      command: 'uvx',
      args: ['dji-mcp-server'],
      env: {},
    },
  },
  {
    id: 'matter',
    label: 'Matter / Thread',
    description: 'Matter standardı IoT — multi-vendor cihaz kontrolü.',
    requires_env: [],
    config_template: {
      command: 'npx',
      args: ['-y', 'matter-mcp-bridge'],
    },
  },
  {
    id: 'apple-music',
    label: 'Apple Music',
    description: 'Apple Music — search, play, queue, playlist (macOS Music.app).',
    requires_env: [],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-applemusic'],
    },
  },
  {
    id: 'whatsapp-mcp',
    label: 'WhatsApp Business',
    description: 'WhatsApp message read/send via Business API.',
    requires_env: ['WHATSAPP_API_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
    config_template: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-whatsapp'],
      env: {},
    },
  },
];

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

function readMcp() {
  if (!fs.existsSync(MCP_PATH)) return { mcpServers: {} };
  try { return JSON.parse(fs.readFileSync(MCP_PATH, 'utf-8')); }
  catch { return { mcpServers: {} }; }
}

function writeMcp(data) {
  fs.mkdirSync(path.dirname(MCP_PATH), { recursive: true });
  const tmp = `${MCP_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, MCP_PATH);
}

async function presetsHandler(req, res) {
  const installed = readMcp().mcpServers || {};
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    presets: PRESETS.map((p) => ({
      ...p,
      installed: !!installed[p.id],
    })),
  }));
}

async function installedHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(readMcp()));
}

async function statusHandler(req, res) {
  // Alive check via parent-child relationship: agent.service spawns each MCP as a
  // stdio subprocess. If agent is running AND log file has at least one "started"
  // marker AFTER agent's start time, the MCP is alive (children share parent's
  // lifetime — when agent dies, they die too via SIGPIPE on stdin close).
  const logDir = path.join(os.homedir(), '.jarvis', 'logs', 'mcp');
  const installed = readMcp().mcpServers || {};
  const agentInfo = agentServiceInfo();
  const status = {};
  for (const name of Object.keys(installed)) {
    const safe = name.replace(/[^A-Za-z0-9_-]/g, '') || 'server';
    const logPath = path.join(logDir, `${safe}.log`);
    let alive = false, last_log = null, error = null, started_count = 0;
    try {
      if (fs.existsSync(logPath)) {
        const st = fs.statSync(logPath);
        last_log = st.mtimeMs;
        const tail = fs.readFileSync(logPath, 'utf-8').slice(-4000);
        started_count = (tail.match(/=== .* started ===/g) || []).length;
        // alive if agent up + log shows server was started after agent boot
        alive = agentInfo.running && started_count > 0 &&
                (agentInfo.startMs == null || st.mtimeMs >= agentInfo.startMs - 5000);
        const errMatch = tail.match(/Error:.+|EACCES|ENOENT|MODULE_NOT_FOUND/);
        if (errMatch) error = errMatch[0].slice(0, 120);
      } else if (agentInfo.running) {
        // log not yet written — server probably died on init
        error = 'no log — startup may have failed';
      }
    } catch { /* noop */ }
    status[name] = { alive, last_log, error, started_count };
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status,
    agent_running: agentInfo.running,
    agent_pid: agentInfo.pid,
    agent_children: agentInfo.childCount,
  }));
}

function agentServiceInfo() {
  try {
    const pidLine = execSync('pgrep -f "agent.service" 2>/dev/null | head -1 || true', { timeout: 2000 }).toString().trim();
    if (!pidLine) return { running: false, pid: null, startMs: null, childCount: 0 };
    const pid = parseInt(pidLine, 10);
    let startMs = null;
    try {
      // ps -o lstart format (e.g. "Cum  8 May 14:24:21 2026")
      const lstart = execSync(`ps -o lstart= -p ${pid}`, { timeout: 2000 }).toString().trim();
      // Strip locale day prefix and parse the rest
      const cleaned = lstart.replace(/^\S+\s+/, '');
      const parsed = Date.parse(cleaned);
      if (!Number.isNaN(parsed)) startMs = parsed;
    } catch { /* noop */ }
    let childCount = 0;
    try {
      const kids = execSync(`pgrep -P ${pid} 2>/dev/null || true`, { timeout: 2000 }).toString().trim();
      childCount = kids ? kids.split('\n').length : 0;
    } catch { /* noop */ }
    return { running: true, pid, startMs, childCount };
  } catch { return { running: false, pid: null, startMs: null, childCount: 0 }; }
}

async function customAddHandler(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch { res.writeHead(400); res.end('bad json'); return; }
  const name = String(body.name || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'invalid name (a-zA-Z0-9_-)' }));
    return;
  }
  const command = String(body.command || '').trim();
  if (!command) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'command required' }));
    return;
  }
  const args = Array.isArray(body.args) ? body.args.map((a) => String(a)) : [];
  const env = body.env && typeof body.env === 'object' ? body.env : {};
  const data = readMcp();
  data.mcpServers = data.mcpServers || {};
  const config = { command, args };
  if (Object.keys(env).length > 0) config.env = env;
  data.mcpServers[name] = config;
  writeMcp(data);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, name, restart_required: true }));
}

async function installHandler(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch { res.writeHead(400); res.end('bad json'); return; }
  const preset = PRESETS.find((p) => p.id === body.id);
  if (!preset) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `unknown preset: ${body.id}` }));
    return;
  }
  // Validate required env values
  const env = body.env || {};
  for (const key of preset.requires_env) {
    if (!env[key]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `missing env: ${key}` }));
      return;
    }
  }
  const data = readMcp();
  data.mcpServers = data.mcpServers || {};
  const config = JSON.parse(JSON.stringify(preset.config_template));
  if (preset.requires_env.length > 0) {
    config.env = { ...(config.env || {}), ...env };
  }
  data.mcpServers[preset.id] = config;
  writeMcp(data);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, id: preset.id, restart_required: true }));
}

async function uninstallHandler(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch { res.writeHead(400); res.end(); return; }
  const data = readMcp();
  if (data.mcpServers && data.mcpServers[body.id]) {
    delete data.mcpServers[body.id];
    writeMcp(data);
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, id: body.id, restart_required: true }));
}

function handleHttp(req, res) {
  if (!req.url.startsWith('/api/mcp/')) return null;
  if (req.method === 'GET' && req.url === '/api/mcp/presets')   return presetsHandler(req, res);
  if (req.method === 'GET' && req.url === '/api/mcp/installed') return installedHandler(req, res);
  if (req.method === 'GET' && req.url === '/api/mcp/status')    return statusHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/mcp/install')  return installHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/mcp/custom')   return customAddHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/mcp/uninstall') return uninstallHandler(req, res);
  res.writeHead(404);
  res.end();
  return undefined;
}

module.exports = { handleHttp };
