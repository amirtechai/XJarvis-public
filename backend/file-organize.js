/**
 * File auto-organize — ~/Downloads (default) klasörünü periyodik tarar,
 * her yeni dosyayı LLM ile kategorize eder ve uygun alt klasöre taşır.
 *
 *   Kategoriler (default):
 *     - documents/    (pdf, doc, txt, md)
 *     - images/       (png, jpg, heic, gif)
 *     - videos/       (mp4, mov, mkv)
 *     - audio/        (mp3, wav, m4a, flac)
 *     - archives/     (zip, tar.gz, dmg)
 *     - installers/   (pkg, dmg, app)
 *     - code/         (py, js, ts, sh, json, html)
 *     - other/
 *
 *   Ek olarak: 30+ gün sırf kalan dosyaları archive/ alt-alt-klasörüne taşı.
 *
 * Default kapalı (file mutation yapıyor — kullanıcı açacak).
 *
 * Config: ~/.config/xjarvis/file-organize.json {enabled, watch_dir, archive_days}
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'xjarvis', 'file-organize.json');
let config = {
  enabled: false,
  watch_dir: path.join(os.homedir(), 'Downloads'),
  archive_days: 30,
  interval_min: 30,
};
let timer = null;

function loadConfig() {
  try { if (fs.existsSync(CONFIG_PATH)) Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))); } catch {}
}
function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

const RULES = [
  { match: /\.(pdf|docx?|txt|md|rtf|pages|odt)$/i, dir: 'documents' },
  { match: /\.(png|jpe?g|gif|heic|webp|bmp|tiff?)$/i, dir: 'images' },
  { match: /\.(mp4|mov|mkv|avi|webm|m4v)$/i, dir: 'videos' },
  { match: /\.(mp3|wav|m4a|flac|aac|ogg)$/i, dir: 'audio' },
  { match: /\.(zip|tar\.gz|tgz|rar|7z|gz|bz2)$/i, dir: 'archives' },
  { match: /\.(pkg|dmg|app|deb|rpm)$/i, dir: 'installers' },
  { match: /\.(py|js|tsx?|jsx|sh|bash|json|ya?ml|html?|css|rb|go|rs|swift)$/i, dir: 'code' },
];

function categorize(filename) {
  for (const r of RULES) {
    if (r.match.test(filename)) return r.dir;
  }
  return 'other';
}

async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }

async function moveFile(src, destDir) {
  await ensureDir(destDir);
  const base = path.basename(src);
  let dest = path.join(destDir, base);
  let i = 2;
  while (fs.existsSync(dest)) {
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    dest = path.join(destDir, `${stem}-${i}${ext}`); i++;
  }
  await fsp.rename(src, dest);
  return dest;
}

async function organizeOnce({ dryRun = false } = {}) {
  if (!config.enabled && !dryRun) return { skipped: 'disabled' };
  const watch = config.watch_dir;
  if (!fs.existsSync(watch)) return { ok: false, error: `${watch} does not exist` };

  const moves = [];
  const archive = [];
  const now = Date.now();
  const archiveCutoff = now - (config.archive_days * 86400_000);

  const entries = await fsp.readdir(watch, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.isDirectory()) continue;                  // skip subdirs
    if (ent.name.startsWith('.')) continue;           // skip hidden
    const src = path.join(watch, ent.name);
    let stats;
    try { stats = await fsp.stat(src); } catch { continue; }

    // Archive old files
    if (stats.mtimeMs < archiveCutoff) {
      const archDir = path.join(watch, 'archive', String(new Date(stats.mtimeMs).getFullYear()));
      if (!dryRun) {
        try { const dest = await moveFile(src, archDir); archive.push({ src, dest }); } catch {}
      } else { archive.push({ src, dest: archDir }); }
      continue;
    }

    const cat = categorize(ent.name);
    const destDir = path.join(watch, cat);
    if (!dryRun) {
      try { const dest = await moveFile(src, destDir); moves.push({ src, dest, cat }); } catch {}
    } else { moves.push({ src, dest: destDir, cat }); }
  }
  return { ok: true, moves: moves.length, archived: archive.length, samples: { moves: moves.slice(0, 5), archive: archive.slice(0, 3) } };
}

function start() {
  loadConfig();
  if (timer) clearInterval(timer);
  timer = setInterval(() => organizeOnce().catch(() => {}), config.interval_min * 60_000);
  console.log(`[file-organize] watcher started (${config.watch_dir}, every ${config.interval_min}m, enabled=${config.enabled})`);
}

function getConfig() { return { ...config }; }
function setConfig(patch) {
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
  if (typeof patch.watch_dir === 'string' && patch.watch_dir) config.watch_dir = patch.watch_dir;
  if (typeof patch.archive_days === 'number' && patch.archive_days > 0) config.archive_days = patch.archive_days;
  if (typeof patch.interval_min === 'number' && patch.interval_min > 0) config.interval_min = patch.interval_min;
  saveConfig(); start();
  return getConfig();
}

function shouldHandle(url) { return url.startsWith('/api/file-organize'); }
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'GET' && req.url === '/api/file-organize/config') {
      res.writeHead(200); res.end(JSON.stringify(getConfig())); return;
    }
    if (req.method === 'POST' && req.url === '/api/file-organize/config') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { res.writeHead(200); res.end(JSON.stringify(setConfig(JSON.parse(body || '{}')))); }
        catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/file-organize/run') {
      const r = await organizeOnce({ dryRun: false });
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && req.url === '/api/file-organize/dry-run') {
      const r = await organizeOnce({ dryRun: true });
      res.writeHead(200); res.end(JSON.stringify(r)); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { start, organizeOnce, getConfig, setConfig, shouldHandle, handleHttp };
