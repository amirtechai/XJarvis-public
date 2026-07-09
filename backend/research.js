/**
 * Perplexity-style research agent.
 *   POST /api/research  {query} → {summary, citations: [{title,url,snippet}]}
 *
 * Pipeline:
 *   1. Tavily web search (5 results)
 *   2. Map each result → fetch snippet (already in Tavily response)
 *   3. Concatenate context, ask Claude (agent :8767, abonelik SDK) for grounded summary
 *
 * Requires TAVILY_API_KEY + running agent service (no API key).
 */
const https = require('https');
const llm = require('./llm-sdk');

function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on('data', (x) => c.push(x));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf-8')));
  });
}

function postJson(host, path, headers, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      method: 'POST', host, path,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
      timeout: 60_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ status: 0, error: 'timeout' }); });
    req.write(payload); req.end();
  });
}

async function tavilySearch(query, key) {
  const r = await postJson('api.tavily.com', '/search', {}, {
    api_key: key,
    query,
    search_depth: 'advanced',
    max_results: 6,
    include_answer: true,
    include_raw_content: false,
  });
  if (r.status !== 200 || !r.json) return { ok: false, error: r.error || `tavily ${r.status}` };
  return {
    ok: true,
    answer: r.json.answer || '',
    results: (r.json.results || []).map((x) => ({
      title: x.title, url: x.url, snippet: x.content || '',
    })),
  };
}

async function summarize(query, results) {
  const context = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
  const r = await llm.complete({
    prompt: `User question: ${query}\n\nWeb search results:\n${context}\n\nWrite a comprehensive answer in markdown with inline citations like [1] [2]. Be concise but thorough. Group findings, avoid filler. End with "## Key takeaways" — 3 bullet points.`,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, text: r.text };
}

function shouldHandle(url) { return url.startsWith('/api/research'); }

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST' || !req.url.startsWith('/api/research')) {
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return;
  }
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const query = String(body.query || '').trim();
    if (!query) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'query required' })); return; }
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!tavilyKey) { res.writeHead(503); res.end(JSON.stringify({ ok: false, error: 'TAVILY_API_KEY missing' })); return; }
    const search = await tavilySearch(query, tavilyKey);
    if (!search.ok) { res.writeHead(502); res.end(JSON.stringify(search)); return; }
    const summary = await summarize(query, search.results);
    res.writeHead(summary.ok ? 200 : 502);
    res.end(JSON.stringify({
      ok: summary.ok,
      query,
      tavily_answer: search.answer,
      summary: summary.ok ? summary.text : null,
      citations: search.results,
      error: summary.error,
    }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { handleHttp, shouldHandle };
