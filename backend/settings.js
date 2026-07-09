const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const JARVIS_DIR = path.join(os.homedir(), '.jarvis');
const SERVERS_PATH = path.join(JARVIS_DIR, 'servers.json');
const MODEL_RULES_PATH = path.join(JARVIS_DIR, 'model_rules.json');

const DEFAULT_MODEL_RULES = [
  { pattern: 'code|function|class|debug|implement|program|script', model: 'deepseek-coder:latest', flags: 'i' },
  { pattern: 'why|reason|analyze|explain|compare|difference|pros|cons', model: 'qwen3:4b', flags: 'i' },
];

function ensureDir() {
  if (!fs.existsSync(JARVIS_DIR)) fs.mkdirSync(JARVIS_DIR, { recursive: true });
}

function getModelRules() {
  try {
    if (!fs.existsSync(MODEL_RULES_PATH)) return DEFAULT_MODEL_RULES;
    return JSON.parse(fs.readFileSync(MODEL_RULES_PATH, 'utf8'));
  } catch {
    return DEFAULT_MODEL_RULES;
  }
}

function saveModelRules(rules) {
  ensureDir();
  fs.writeFileSync(MODEL_RULES_PATH, JSON.stringify(rules, null, 2));
}

function getServers() {
  try {
    if (!fs.existsSync(SERVERS_PATH)) return [];
    return JSON.parse(fs.readFileSync(SERVERS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveServers(servers) {
  ensureDir();
  fs.writeFileSync(SERVERS_PATH, JSON.stringify(servers, null, 2));
}

function getConnectors(ws) {
  return new Promise((resolve) => {
    exec('python3 ' + path.join(__dirname, 'connectors.py'), { timeout: 10000 }, (err, stdout, stderr) => {
      try {
        const connectors = JSON.parse(stdout);
        ws.send(JSON.stringify({ type: 'connectors', connectors }));
      } catch {
        ws.send(JSON.stringify({ type: 'connectors', connectors: [], error: stderr || err?.message }));
      }
      resolve();
    });
  });
}

function syncConnector(name, ws) {
  return new Promise((resolve) => {
    const proc = exec(
      `python3 ${path.join(__dirname, 'connector_sync.py')} "${name.replace(/"/g, '')}"`,
      { timeout: 120000 },
      (err, stdout) => {
        try {
          const msg = JSON.parse(stdout?.trim().split('\n').pop() ?? '{}');
          if (msg.done) {
            ws.send(JSON.stringify({ type: 'connector_synced', name, total: msg.total }));
          } else {
            ws.send(JSON.stringify({ type: 'connector_sync_error', name, error: msg.err || err?.message }));
          }
        } catch {
          ws.send(JSON.stringify({ type: 'connector_sync_error', name, error: err?.message ?? 'unknown' }));
        }
        resolve();
      }
    );
    void proc;
  });
}

module.exports = { getConnectors, syncConnector, getModelRules, saveModelRules, getServers, saveServers };
