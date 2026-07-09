/**
 * XJarvis agent client — streams from Python agent service via SSE.
 * Falls back to caller's catch handler if agent service is offline.
 */
const http = require('http');
const { bus, EVENT_TYPES } = require('./events/bus');

const AGENT_HOST = '127.0.0.1';
const AGENT_PORT = parseInt(process.env.AGENT_PORT || '8767', 10);

function streamXJarvis(query, ws, files) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, files: Array.isArray(files) ? files : [] });
    const req = http.request(
      {
        host: AGENT_HOST,
        port: AGENT_PORT,
        path: '/agent/query',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 90000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`agent returned ${res.statusCode}`));
          res.resume();
          return;
        }
        if (ws && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'model_selected', model: 'xjarvis' }));
        }

        let buffer = '';
        let started = false;
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
          buffer += chunk;
          // Sınırsız büyümeyi engelle (1 MB): kuyruktan kesmek SSE event'ini
          // ortadan böler ve sonraki parse'ları da bozar — temiz sıfırla.
          if (buffer.length > 1_000_000) {
            console.warn(`[agent] SSE buffer ${buffer.length}B aştı, event düşürülüyor`);
            buffer = '';
          }
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = block.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'text') {
                if (!started) {
                  started = true;
                  // Note: agent.service.py already emits RESPONSE_START /
                  // _CHUNK / _END to the bus directly. We forward to the
                  // WS client here for the local UI, but do NOT re-emit to
                  // the bus or every listener (tts_bridge, server-bridge)
                  // would receive each chunk twice.
                }
                if (ws && ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'stream_chunk', content: ev.content }));
                }
              } else if (ev.type === 'tool_start') {
                if (ws && ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'tool_start',
                    name: ev.name,
                    args: ev.args,
                  }));
                }
                bus.emit(EVENT_TYPES.TOOL_CALL_START, { name: ev.name, args: ev.args }, 'system');
              } else if (ev.type === 'tool_end') {
                if (ws && ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'tool_end',
                    name: ev.name,
                  }));
                }
                bus.emit(EVENT_TYPES.TOOL_CALL_END, { name: ev.name }, 'system');
              } else if (ev.type === 'error') {
                if (ws && ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'error', message: ev.message }));
                }
              }
            } catch (e) {
              console.debug('[agent] malformed SSE event:', e.message);
            }
          }
        });
        res.on('end', () => {
          if (ws && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'stream_end' }));
          }
          // RESPONSE_END is already emitted by agent.service.py.
          resolve();
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('agent timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function isAgentUp() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: AGENT_HOST, port: AGENT_PORT, path: '/health', method: 'GET', timeout: 800 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

module.exports = { streamXJarvis, isAgentUp };
