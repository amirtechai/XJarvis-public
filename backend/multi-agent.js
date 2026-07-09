/**
 * Multi-agent orchestrator (MVP).
 *
 * Verilen bir görev için farklı uzmanlık prompt'ları ile aynı LLM'i sırayla
 * çağırır:
 *   • Researcher  — knowledge_search + web_search ile bilgi topla
 *   • Writer      — düzgün metin/rapor üret
 *   • Coder       — kod yaz
 *   • Reviewer    — eleştirel oku, eksiklikleri çıkar
 *
 * Orchestrator sırası: pipeline modu (research → write → review)
 * veya parallel (research + code + review) + final birleşim.
 *
 * MVP sequential pipeline. Geleceği: paralel + sub-agent loop.
 *
 *   POST /api/agents/run { task, pipeline?: ["researcher","writer","reviewer"] }
 *      → returns aggregated result + per-step outputs
 */
const path = require('path');
const { spawn } = require('child_process');

const ROLES = {
  researcher: {
    system: 'Sen XJarvis araştırmacı uzmanısın. Verilen konu için knowledge_search (kişisel kaynaklar) ve web_search (genel internet) araçlarını kullanarak çok kaynaklı, yan-tutmayan, doğrulanabilir bilgi topla. Çıktın madde madde, kaynak referansları ile.',
  },
  writer: {
    system: 'Sen XJarvis yazar uzmanısın. Sana sağlanan bilgi ve talimatla kullanıcı için Türkçe, akıcı, düzgün yapılandırılmış (gerekiyorsa başlıklar + paragraflar) bir metin üret. Spekülasyon yok.',
  },
  coder: {
    system: 'Sen XJarvis kodlayıcı uzmanısın. Verilen göreve uygun, çalıştırılabilir, tek dosyalık kod yaz. Önce dilini seç (Python/TS/Bash), sonra kodu kod bloğunda ver. Yorum azı kullan, kod kendini açıklasın.',
  },
  reviewer: {
    system: 'Sen XJarvis eleştirel inceleyicisisin. Sana gösterilen çıktıyı eleştir: doğruluk, eksiklik, çelişki, eylemsiz öneri. Madde madde, kısa. Hatalı varsa düzelt.',
  },
};

function runAgentWithSystem(systemPrompt, userPrompt) {
  return new Promise((resolve) => {
    const proc = spawn(process.env.PYTHON_BIN || 'python3', [
      path.join(__dirname, 'openjarvis_ask.py'), userPrompt,
    ], {
      env: {
        ...process.env,
        PYTHONPATH: process.env.OPENJARVIS_SRC || '',
        // Override system prompt by adding a special prefix env var that
        // openjarvis_ask.py will read (if implemented). For now we simply
        // prepend the role into the user prompt so the LLM acts in role.
        XJARVIS_ROLE_PROMPT: systemPrompt,
      },
    });
    let buf = '';
    proc.stdout.on('data', (c) => { buf += c.toString(); });
    proc.on('close', () => {
      const tokens = [];
      buf.split('\n').forEach((line) => {
        try { const j = JSON.parse(line); if (j.t) tokens.push(j.t); } catch {}
      });
      resolve(tokens.join('').trim());
    });
    setTimeout(() => { try { proc.kill(); } catch {} resolve(buf.slice(0, 1500)); }, 180_000);
  });
}

async function runPipeline(task, pipeline = ['researcher', 'writer', 'reviewer']) {
  const results = [];
  let context = `Görev: ${task}`;
  for (const role of pipeline) {
    const r = ROLES[role];
    if (!r) continue;
    const userPrompt = `[Rol: ${role.toUpperCase()}]\nSistem talimatı: ${r.system}\n\n${context}`;
    const output = await runAgentWithSystem(r.system, userPrompt);
    results.push({ role, output });
    // Feed previous output as context to the next role
    context = `Görev: ${task}\n\nÖnceki adım [${role}] çıktısı:\n${output}\n\nBunu dikkate alarak kendi rolünü oyna.`;
  }
  return { ok: true, task, results };
}

function shouldHandle(url) {
  // Only the legacy single endpoint — avoid clashing with /api/agents/runs (agents-runs.js)
  return url === '/api/agents/run' || url.startsWith('/api/agents/run?');
}
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(JSON.stringify({ error: 'POST only' })); return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const { task, pipeline } = JSON.parse(body || '{}');
      if (!task) { res.writeHead(400); res.end(JSON.stringify({ error: 'task required' })); return; }
      const r = await runPipeline(task, Array.isArray(pipeline) ? pipeline : undefined);
      res.writeHead(200); res.end(JSON.stringify(r));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
  });
}

module.exports = { runPipeline, ROLES, shouldHandle, handleHttp };
