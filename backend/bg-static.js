// Arka plan video şovu için range-destekli static servis.
// WKWebView (Tauri) <video> oynatmak için HTTP range (206) ister; gömülü Tauri
// protokolü bunu vermediğinden video'ları buradan, range desteğiyle sunuyoruz.

const fs = require('fs');
const path = require('path');

const BG_DIR = path.join(__dirname, 'bg-media');

function shouldHandle(url) {
  return typeof url === 'string' && url.startsWith('/bg/');
}

function safeName(url) {
  // /bg/<file> → sadece dosya adı; path traversal'a izin verme.
  const name = decodeURIComponent(url.replace(/^\/bg\//, '').split('?')[0]);
  if (!/^[A-Za-z0-9._-]+\.mp4$/.test(name)) return null;
  return name;
}

function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');

  const name = safeName(req.url);
  if (!name) {
    res.writeHead(400);
    return res.end('bad name');
  }
  const file = path.join(BG_DIR, name);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404);
    return res.end('not found');
  }

  const total = stat.size;
  const range = req.headers.range;
  const baseHeaders = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
  };

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': total });
  fs.createReadStream(file).pipe(res);
}

module.exports = { shouldHandle, handle };
