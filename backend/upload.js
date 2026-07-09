/**
 * Dosya yükleme + tür-bazlı önişleme.
 *
 * POST /api/upload?name=<dosyaadı>  (gövde = ham dosya baytları, tek dosya/istek)
 *   → ~/.jarvis/uploads/<id>-<ad> olarak kaydeder, türe göre işler ve agent'ın
 *     kullanabileceği bir "contentPath" döndürür:
 *       image            → görsel path (agent vision ile analiz eder)
 *       pdf              → pdftotext → .txt
 *       docx/doc/rtf/... → textutil → .txt   (macOS yerleşik, ek bağımlılık yok)
 *       ses/video        → ffmpeg + whisper-cli → transkript .txt  (yerel, ücretsiz)
 *       metin/kod        → olduğu gibi (.md/.txt/.json/.py…)
 *   Yanıt: { ok, name, kind:'image'|'text', contentPath }
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const UPLOAD_DIR = path.join(os.homedir(), '.jarvis', 'uploads');
const WHISPER_BIN = process.env.WHISPER_CLI_BIN || '/opt/homebrew/bin/whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_CLI_MODEL ||
  path.join(os.homedir(), '.cache/whisper-models/ggml-small.bin');

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'heic', 'heif']);
const AV_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);
const DOC_EXT = new Set(['pdf', 'docx', 'doc', 'rtf', 'odt', 'pages', 'html', 'htm']);

function shouldHandle(url) {
  return !!url && url.split('?')[0] === '/api/upload';
}

function sanitize(name) {
  return (name || 'file').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 90) || 'file';
}

function run(cmd, args, timeout = 120000) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
}

function extractDoc(src, ext, base) {
  const out = `${base}.txt`;
  if (ext === 'pdf') {
    run('pdftotext', ['-layout', '-q', src, out]);
  } else {
    run('/usr/bin/textutil', ['-convert', 'txt', '-output', out, src]); // docx/doc/rtf/odt/html/pages
  }
  return out;
}

function transcribe(src, base) {
  const wav = `${base}.16k.wav`;
  run('ffmpeg', ['-y', '-i', src, '-ar', '16000', '-ac', '1', '-f', 'wav', wav], 300000);
  run(WHISPER_BIN, ['-m', WHISPER_MODEL, '-f', wav, '-l', 'auto', '--output-txt', '-of', base], 600000);
  try { fs.unlinkSync(wav); } catch { /* noop */ }
  return `${base}.txt`; // whisper-cli <base>.txt yazar
}

async function handle(req, res) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    const u = new URL(req.url, 'http://localhost');
    const name = sanitize(u.searchParams.get('name') || 'file');
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', (c) => chunks.push(c));
      req.on('end', resolve);
      req.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    if (!buf.length) return json(400, { ok: false, error: 'boş dosya' });

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const id = crypto.randomUUID().slice(0, 8);
    const saved = path.join(UPLOAD_DIR, `${id}-${name}`);
    fs.writeFileSync(saved, buf);
    const ext = (name.split('.').pop() || '').toLowerCase();

    let kind = 'text';
    let contentPath = saved;
    try {
      if (IMAGE_EXT.has(ext)) {
        kind = 'image';
        if (ext === 'heic' || ext === 'heif') {
          const jpg = `${saved}.jpg`;
          run('sips', ['-s', 'format', 'jpeg', saved, '--out', jpg]);
          contentPath = jpg;
        }
      } else if (AV_EXT.has(ext)) {
        contentPath = transcribe(saved, saved);
      } else if (DOC_EXT.has(ext)) {
        contentPath = extractDoc(saved, ext, saved);
      }
      // metin/kod → contentPath = saved (olduğu gibi)
    } catch (e) {
      // önişleme patlarsa yine de ham path'i ver (agent elinden geleni yapar)
      return json(200, { ok: true, name, kind, contentPath: saved, warning: String(e.message || e).slice(0, 200) });
    }
    return json(200, { ok: true, name, kind, contentPath });
  } catch (e) {
    return json(500, { ok: false, error: String(e.message || e) });
  }
}

module.exports = { shouldHandle, handle, UPLOAD_DIR };
