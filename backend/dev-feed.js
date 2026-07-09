/**
 * Dev mode için PR + commit + log feed.
 *   GET /api/dev/prs?owner=&repo=
 *   GET /api/dev/commits?owner=&repo=&since=
 *   GET /api/dev/logs?lines=50
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

function ghGet(p) {
  return new Promise((resolve, reject) => {
    const tok = process.env.GITHUB_TOKEN;
    const headers = { 'User-Agent': 'XJarvis', 'Accept': 'application/vnd.github+json' };
    if (tok) headers['Authorization'] = `token ${tok}`;
    https.get({ host: 'api.github.com', path: p, headers, timeout: 10_000 }, (res) => {
      const cs = []; res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const text = Buffer.concat(cs).toString();
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, json: { raw: text } }); }
      });
    }).on('error', reject);
  });
}

async function prsHandler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const u = new URL(req.url, 'http://x');
  const owner = u.searchParams.get('owner') || process.env.GITHUB_FEED_OWNER || 'anthropics';
  const repo = u.searchParams.get('repo');
  try {
    if (repo) {
      const r = await ghGet(`/repos/${owner}/${repo}/pulls?state=open&per_page=20`);
      const items = (r.json || []).map((p) => ({
        repo: `${owner}/${repo}`, number: p.number, title: p.title,
        author: p.user?.login, draft: p.draft, url: p.html_url,
        updated: p.updated_at, head: p.head?.ref,
      }));
      res.writeHead(200); res.end(JSON.stringify({ ok: true, count: items.length, items }));
      return;
    }
    // Owner'ın tüm repolarındaki açık PR'lar
    const repos = await ghGet(`/users/${owner}/repos?per_page=20&sort=updated`);
    const all = [];
    for (const r of (repos.json || []).slice(0, 10)) {
      const prs = await ghGet(`/repos/${owner}/${r.name}/pulls?state=open&per_page=5`);
      for (const p of (prs.json || [])) {
        all.push({
          repo: `${owner}/${r.name}`, number: p.number, title: p.title,
          author: p.user?.login, draft: p.draft, url: p.html_url, updated: p.updated_at,
        });
      }
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, count: all.length, items: all }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

async function commitsHandler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const u = new URL(req.url, 'http://x');
  const owner = u.searchParams.get('owner') || process.env.GITHUB_FEED_OWNER || 'anthropics';
  const repo = u.searchParams.get('repo');
  if (!repo) { res.writeHead(400); res.end(JSON.stringify({ error: 'repo required' })); return; }
  const since = u.searchParams.get('since') || new Date(Date.now() - 24 * 3600_000).toISOString();
  try {
    const r = await ghGet(`/repos/${owner}/${repo}/commits?since=${encodeURIComponent(since)}&per_page=20`);
    const items = (r.json || []).map((c) => ({
      sha: (c.sha || '').slice(0, 7),
      msg: (c.commit?.message || '').split('\n')[0],
      author: c.commit?.author?.name, date: c.commit?.author?.date,
      url: c.html_url,
    }));
    res.writeHead(200); res.end(JSON.stringify({ ok: true, count: items.length, items }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

async function logsHandler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const u = new URL(req.url, 'http://x');
  const N = Math.min(200, parseInt(u.searchParams.get('lines') || '50', 10));
  const dir = path.join(os.homedir(), '.jarvis', 'logs');
  const out = {};
  try {
    if (!fs.existsSync(dir)) {
      res.writeHead(200); res.end(JSON.stringify({ ok: true, files: {} })); return;
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).slice(0, 6);
    for (const f of files) {
      try {
        const p = path.join(dir, f);
        const s = fs.statSync(p);
        const content = fs.readFileSync(p, 'utf-8');
        const lines = content.split('\n').slice(-N);
        out[f] = { size: s.size, mtime: s.mtime, tail: lines };
      } catch { /* skip */ }
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, files: out }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

function shouldHandle(url) { return url.startsWith('/api/dev/'); }
async function handleHttp(req, res) {
  const u = req.url;
  if (u.startsWith('/api/dev/prs'))     return prsHandler(req, res);
  if (u.startsWith('/api/dev/commits')) return commitsHandler(req, res);
  if (u.startsWith('/api/dev/logs'))    return logsHandler(req, res);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { shouldHandle, handleHttp };
