/**
 * Dosya metin çıkarma — pdf / docx / doc / metin türleri.
 * (Görsel→vision, ses/video→whisper tg-extra tarafında.)
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 24 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').toString().slice(0, 200)));
      resolve(stdout);
    });
  });
}

const TEXT_EXT = ['txt', 'md', 'csv', 'json', 'log', 'js', 'ts', 'py', 'html', 'css', 'xml', 'yaml', 'yml', 'sh', 'sql'];

async function extractText(localPath, mime = '', name = '') {
  const ext = (path.extname(name || localPath).toLowerCase().replace('.', '')) || '';
  const m = (mime || '').toLowerCase();

  if (/^text\//.test(m) || TEXT_EXT.includes(ext)) {
    return fs.readFileSync(localPath, 'utf-8');
  }
  if (ext === 'pdf' || m.includes('pdf')) {
    const t = await run('pdftotext', ['-layout', localPath, '-']);
    if (t && t.trim()) return t;
    throw new Error('PDF metni okunamadı (taranmış/görüntü PDF olabilir)');
  }
  if (ext === 'docx' || m.includes('officedocument.wordprocessingml')) {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ path: localPath });
    return r.value || '';
  }
  if (ext === 'doc' || m === 'application/msword') {
    return await run('antiword', [localPath]);
  }
  throw new Error('desteklenmeyen belge türü: ' + (ext || m || '?'));
}

module.exports = { extractText };
