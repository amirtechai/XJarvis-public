/**
 * Self-extending skills (MVP) — agent eksik bir yetenek fark ettiğinde
 * yeni bir skill dosyası ürettirir.
 *
 * POST /api/skills/generate { description: "şunu yapabilen skill yaz" }
 *   → LLM markdown skill body üretir → agent/skills/<slug>.md'ye yazar →
 *     skills.js install pipeline'ına girer.
 *
 * Güvenlik: skill body sadece markdown (prompt instruction). Kod execute
 * etmez. Daha gelişmiş "tool generation" (Python code) ileride ayrı bir
 * endpoint olacak.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const SKILLS_DIR = path.join(__dirname, '..', 'agent', 'skills');

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[ğ]/g, 'g').replace(/[ü]/g, 'u').replace(/[ş]/g, 's')
    .replace(/[ı]/g, 'i').replace(/[ö]/g, 'o').replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'skill';
}

function callLLM(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.4 });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-SkillGen' },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          resolve(j.choices?.[0]?.message?.content || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.write(payload); req.end();
  });
}

const SYSTEM = `Sen XJarvis için yeni bir skill (markdown talimat seti) yazıyorsun.
Skill yapısı:

---
name: <kebab-case-name>
description: <tek satır, ne işe yarar>
---

# <Başlık>

<Türkçe talimat — kullanıcı hangi cümlelerle bu skill'i tetikler, agent ne yapacak, hangi araçları kullanacak. shell_exec, web_search, knowledge_search, browser_navigate vb. mevcut tool'ları kullan. Markdown listeler ve kod blokları kullan. Net, kısa, Türkçe ton.>

Sadece skill içeriğini döndür. Açıklama, kod fence (\`\`\`) veya başka metin ekleme.`;

async function generate(description) {
  if (!description || description.length < 5) {
    return { ok: false, error: 'description too short' };
  }
  const body = await callLLM([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: description.trim() },
  ]);
  if (!body) return { ok: false, error: 'LLM unavailable' };

  // Sanity check the body has a frontmatter
  const trimmed = body.trim().replace(/^```\w*\n?|\n?```$/g, '');
  if (!trimmed.startsWith('---')) {
    return { ok: false, error: 'malformed skill body', body: trimmed.slice(0, 200) };
  }

  // Extract name from frontmatter for filename
  const nameMatch = trimmed.match(/^name:\s*(.+)$/m);
  const name = nameMatch ? slugify(nameMatch[1]) : slugify(description);

  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const filePath = path.join(SKILLS_DIR, `${name}.md`);
  // Don't overwrite — append timestamp suffix if collision
  let final = filePath;
  let i = 2;
  while (fs.existsSync(final)) {
    final = path.join(SKILLS_DIR, `${name}-${i}.md`); i++;
  }
  fs.writeFileSync(final, trimmed);
  return { ok: true, name, file: final, body: trimmed };
}

// ---------------------------------------------------------------------------
// Python tool generation (deeper) — agent yeni bir araç (gerçek kod) yazar,
// ama otomatik register ETMEZ. Önce sandbox dizine yazar, sonra kullanıcı
// UI'dan inceleyip onayladığında resmi tools/ klasörüne taşınır.
// ---------------------------------------------------------------------------
const TOOL_SANDBOX = path.join(__dirname, '..', 'sandbox', 'pending-tools');

const TOOL_SYS = `Sen XJarvis için yeni bir Python aracı yazıyorsun. OpenJarvis'in BaseTool sınıfını genişleteceksin.

Şablon (TIPATIP uy, sadece tool_id, spec, ve execute() kısımlarını doldur):

\`\`\`python
"""<one-line description>"""

from __future__ import annotations
from typing import Any
from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec


@ToolRegistry.register("<snake_case_tool_id>")
class <CamelCase>Tool(BaseTool):
    tool_id = "<snake_case_tool_id>"
    is_local = True

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="<snake_case_tool_id>",
            description="<what this tool does, used by LLM>",
            parameters={
                "type": "object",
                "properties": {
                    # ... param schema
                },
                "required": [],
            },
            category="custom",
        )

    def execute(self, **params: Any) -> ToolResult:
        # implementation here
        return ToolResult(tool_name="<snake_case_tool_id>", content="<result>", success=True)
\`\`\`

Kurallar:
- Network çağrısı yapacaksan httpx kullan, asla raw socket
- File system erişiminde sadece os.path.expanduser ile başlayan path'lere yaz
- Subprocess kullanma (güvenlik)
- Kullanıcı isterse Türkçe ya da İngilizce param isimleri olabilir, ama tool_id daima snake_case İngilizce
- Sadece kodu döndür. Markdown fence YOK, açıklama YOK.`;

async function generateTool(description) {
  if (!description || description.length < 10) {
    return { ok: false, error: 'description too short' };
  }
  const code = await callLLM([
    { role: 'system', content: TOOL_SYS },
    { role: 'user', content: description.trim() },
  ]);
  if (!code) return { ok: false, error: 'LLM unavailable' };

  // Strip code fences if any
  const cleaned = code.trim().replace(/^```\w*\n?|\n?```$/g, '');

  // Light validation: must contain @ToolRegistry.register and class definition
  if (!cleaned.includes('@ToolRegistry.register') || !cleaned.includes('class ')) {
    return { ok: false, error: 'malformed tool', body: cleaned.slice(0, 240) };
  }

  // Extract tool_id from the @ToolRegistry.register("...") decorator
  const idMatch = cleaned.match(/@ToolRegistry\.register\(["']([a-z0-9_]+)["']\)/);
  const toolId = idMatch ? idMatch[1] : slugify(description).replace(/-/g, '_');

  fs.mkdirSync(TOOL_SANDBOX, { recursive: true });
  let target = path.join(TOOL_SANDBOX, `${toolId}.py`);
  let i = 2;
  while (fs.existsSync(target)) {
    target = path.join(TOOL_SANDBOX, `${toolId}-${i}.py`); i++;
  }
  fs.writeFileSync(target, cleaned);

  return {
    ok: true,
    tool_id: toolId,
    file: target,
    body: cleaned,
    needs_review: true,
    note: 'Tool sandbox dizinine yazıldı. POST /api/skills/promote-tool {file} ile resmî tools/ klasörüne taşı (kodu OKUDUKTAN sonra).',
  };
}

function listPendingTools() {
  if (!fs.existsSync(TOOL_SANDBOX)) return [];
  return fs.readdirSync(TOOL_SANDBOX).filter((f) => f.endsWith('.py')).map((f) => {
    const full = path.join(TOOL_SANDBOX, f);
    return {
      file: full,
      name: f,
      size: fs.statSync(full).size,
      preview: fs.readFileSync(full, 'utf-8').slice(0, 600),
    };
  });
}

function promoteTool(file) {
  if (!file || !file.startsWith(TOOL_SANDBOX)) return { ok: false, error: 'invalid file path' };
  if (!fs.existsSync(file)) return { ok: false, error: 'not found' };
  // Final destination: OpenJarvis tools dir. We don't auto-import — user is
  // expected to restart the backend so module loads cleanly.
  const dest = path.join(process.env.OPENJARVIS_SRC || '.', 'openjarvis/tools', path.basename(file));
  fs.copyFileSync(file, dest);
  fs.unlinkSync(file);
  return { ok: true, dest, restart_required: true };
}

function rejectTool(file) {
  if (!file || !file.startsWith(TOOL_SANDBOX)) return { ok: false, error: 'invalid file path' };
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { ok: true };
}

function shouldHandle(url) {
  return url.startsWith('/api/skills/generate') ||
    url.startsWith('/api/skills/generate-tool') ||
    url.startsWith('/api/skills/pending-tools') ||
    url.startsWith('/api/skills/promote-tool') ||
    url.startsWith('/api/skills/reject-tool');
}

function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b || '')); });
}

async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'POST' && req.url === '/api/skills/generate') {
      const { description } = JSON.parse((await readBody(req)) || '{}');
      const r = await generate(description);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'POST' && req.url === '/api/skills/generate-tool') {
      const { description } = JSON.parse((await readBody(req)) || '{}');
      const r = await generateTool(description);
      res.writeHead(r.ok ? 200 : 400); res.end(JSON.stringify(r)); return;
    }
    if (req.method === 'GET' && req.url === '/api/skills/pending-tools') {
      res.writeHead(200); res.end(JSON.stringify(listPendingTools())); return;
    }
    if (req.method === 'POST' && req.url === '/api/skills/promote-tool') {
      const { file } = JSON.parse((await readBody(req)) || '{}');
      res.writeHead(200); res.end(JSON.stringify(promoteTool(file))); return;
    }
    if (req.method === 'POST' && req.url === '/api/skills/reject-tool') {
      const { file } = JSON.parse((await readBody(req)) || '{}');
      res.writeHead(200); res.end(JSON.stringify(rejectTool(file))); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { generate, generateTool, listPendingTools, promoteTool, rejectTool, shouldHandle, handleHttp };
