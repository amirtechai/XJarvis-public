const http = require('http');
const { bus, EVENT_TYPES } = require('./events/bus');

/**
 * Stream a prompt to Ollama and forward tokens to the WebSocket client.
 * @param {string} prompt
 * @param {string} model
 * @param {import('ws').WebSocket} ws
 */
function streamOllama(prompt, model, ws) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, prompt, stream: true });

    const req = http.request(
      {
        hostname: 'localhost',
        port: 11434,
        path: '/api/generate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let started = false;
        res.on('data', (chunk) => {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.response) {
                if (!started) {
                  started = true;
                  bus.emit(EVENT_TYPES.RESPONSE_START, { model }, 'system');
                }
                ws.send(JSON.stringify({ type: 'stream_chunk', content: data.response }));
                bus.emit(EVENT_TYPES.RESPONSE_CHUNK, { text: data.response }, 'system');
              }
              if (data.done) {
                ws.send(JSON.stringify({ type: 'stream_end' }));
                bus.emit(EVENT_TYPES.RESPONSE_END, { model }, 'system');
              }
            } catch {
              // partial JSON line — skip
            }
          }
        });

        res.on('end', resolve);
        res.on('error', reject);
      }
    );

    req.on('error', (err) => {
      ws.send(JSON.stringify({ type: 'error', message: `Ollama unreachable: ${err.message}` }));
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

module.exports = { streamOllama };
