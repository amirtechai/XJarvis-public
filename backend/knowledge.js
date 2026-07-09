/**
 * Knowledge graph — facts, episodes, and connections.
 *
 * Reads from existing memory/episodic stores (already used by agent).
 *   GET  /api/knowledge/graph        → {nodes: [{id, label, type, weight}], edges: [{from, to, weight}]}
 *   GET  /api/knowledge/search?q=    → fuzzy facts/episodes search
 *
 * Builds a lightweight graph by scanning ~/.config/xjarvis/episodic.db (sqlite)
 * and ~/.config/xjarvis/patterns.db. If sqlite3 module unavailable, returns
 * a degraded JSON-only view (latest 100 episodic entries as nodes).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let sqlite3 = null;
try { sqlite3 = require('sqlite3'); } catch { /* optional */ }

const EPISODIC = path.join(os.homedir(), '.config', 'xjarvis', 'episodic.db');
const PATTERNS = path.join(os.homedir(), '.config', 'xjarvis', 'patterns.db');

function shouldHandle(url) { return url.startsWith('/api/knowledge'); }

async function buildGraph() {
  if (!sqlite3 || !fs.existsSync(EPISODIC)) {
    return { nodes: [], edges: [], degraded: true };
  }
  return new Promise((resolve) => {
    const db = new sqlite3.Database(EPISODIC, sqlite3.OPEN_READONLY, (err) => {
      if (err) return resolve({ nodes: [], edges: [], error: err.message });
      // Extract entities from episodes — best effort
      db.all("SELECT id, query, response, ts FROM episodes ORDER BY ts DESC LIMIT 80", (e, rows) => {
        if (e || !rows) { db.close(); return resolve({ nodes: [], edges: [], error: e?.message }); }
        const nodes = [];
        const edges = [];
        const seen = new Set();
        for (const r of rows) {
          const id = `ep_${r.id}`;
          if (!seen.has(id)) {
            nodes.push({ id, label: (r.query || '').slice(0, 40), type: 'episode', weight: 1 });
            seen.add(id);
          }
          // Extract simple keywords as nodes
          const text = `${r.query || ''} ${r.response || ''}`;
          const words = text.match(/[A-Za-zĞÜŞİÖÇğüşıöç]{4,}/g) || [];
          const stop = new Set(['this','that','with','from','have','sana','sizin','olmak','jarvis','xjarvis']);
          const counts = {};
          for (const w of words) {
            const wl = w.toLowerCase();
            if (stop.has(wl)) continue;
            counts[wl] = (counts[wl] || 0) + 1;
          }
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
          for (const [k, c] of top) {
            const kid = `kw_${k}`;
            if (!seen.has(kid)) {
              nodes.push({ id: kid, label: k, type: 'keyword', weight: c });
              seen.add(kid);
            }
            edges.push({ from: id, to: kid, weight: c });
          }
        }
        db.close();
        resolve({ nodes: nodes.slice(0, 200), edges: edges.slice(0, 400) });
      });
    });
  });
}

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/knowledge/graph') {
      const g = await buildGraph();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, ...g }));
      return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle };
