/**
 * Fal.ai backed creative generation.
 *   POST /api/fal/image  body: { prompt, model?, image_size? }
 *
 * Default model: fal-ai/flux/schnell (hızlı, ucuz). prompt zorunlu.
 * Apı key: FAL_API_KEY (.env).
 */
const https = require('https');

const MODELS = {
  'flux-schnell': 'fal-ai/flux/schnell',
  'flux-dev':     'fal-ai/flux/dev',
  'flux-pro':     'fal-ai/flux-pro',
  'sdxl':         'fal-ai/fast-sdxl',
};

function readBody(req) { return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); }); }

function falPost(path, body, key) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      host: 'fal.run', path: `/${path}`, method: 'POST',
      headers: {
        'Authorization': `Key ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 120_000,
    }, (res) => {
      const cs = []; res.on('data', (c) => cs.push(c));
      res.on('end', () => {
        const text = Buffer.concat(cs).toString();
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, json: { raw: text } }); }
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

async function imageHandler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const key = process.env.FAL_API_KEY;
  if (!key) { res.writeHead(503); res.end(JSON.stringify({ ok: false, error: 'FAL_API_KEY missing' })); return; }
  const body = JSON.parse((await readBody(req)) || '{}');
  if (!body.prompt) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'prompt required' })); return; }
  const model = MODELS[body.model] || MODELS['flux-schnell'];
  const payload = {
    prompt: body.prompt,
    image_size: body.image_size || 'square_hd',
    num_images: Math.min(Math.max(parseInt(body.num_images, 10) || 1, 1), 4),
  };
  if (body.seed) payload.seed = body.seed;
  const r = await falPost(model, payload, key);
  if (r.status !== 200) {
    res.writeHead(r.status); res.end(JSON.stringify({ ok: false, body: r.json })); return;
  }
  const images = r.json?.images || (r.json?.image ? [r.json.image] : []);
  const urls = images.map((i) => i?.url).filter(Boolean);
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, url: urls[0] || null, urls, model, raw: r.json }));
}

async function removeBgHandler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const key = process.env.FAL_API_KEY;
  if (!key) { res.writeHead(503); res.end(JSON.stringify({ ok: false, error: 'FAL_API_KEY missing' })); return; }
  const body = JSON.parse((await readBody(req)) || '{}');
  if (!body.image_url) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'image_url required' })); return; }
  const r = await falPost('fal-ai/birefnet', { image_url: body.image_url }, key);
  if (r.status !== 200) { res.writeHead(r.status); res.end(JSON.stringify({ ok: false, body: r.json })); return; }
  const url = r.json?.image?.url || r.json?.url;
  res.writeHead(200); res.end(JSON.stringify({ ok: true, url, raw: r.json }));
}

async function upscaleHandler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const key = process.env.FAL_API_KEY;
  if (!key) { res.writeHead(503); res.end(JSON.stringify({ ok: false, error: 'FAL_API_KEY missing' })); return; }
  const body = JSON.parse((await readBody(req)) || '{}');
  if (!body.image_url) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'image_url required' })); return; }
  const r = await falPost('fal-ai/clarity-upscaler', {
    image_url: body.image_url,
    upscale_factor: body.factor || 2,
  }, key);
  if (r.status !== 200) { res.writeHead(r.status); res.end(JSON.stringify({ ok: false, body: r.json })); return; }
  const url = r.json?.image?.url || r.json?.images?.[0]?.url;
  res.writeHead(200); res.end(JSON.stringify({ ok: true, url, raw: r.json }));
}

function shouldHandle(url) { return url.startsWith('/api/fal/') || url.startsWith('/api/design/'); }

async function handleHttp(req, res) {
  if (req.method === 'POST' && (req.url.startsWith('/api/fal/image') || req.url.startsWith('/api/design/generate'))) {
    return imageHandler(req, res);
  }
  if (req.method === 'POST' && (req.url.startsWith('/api/fal/remove-bg') || req.url.startsWith('/api/design/remove-bg'))) {
    return removeBgHandler(req, res);
  }
  if (req.method === 'POST' && (req.url.startsWith('/api/fal/upscale') || req.url.startsWith('/api/design/upscale'))) {
    return upscaleHandler(req, res);
  }
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { shouldHandle, handleHttp };
