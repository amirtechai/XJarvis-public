/**
 * Quick capture — global hotkey/tray ile gelen kısa metni LLM kategorize eder
 * ve doğru hedefe yazar:
 *   - reminder → Apple Reminders
 *   - note → Apple Notes
 *   - task → goals.db'de yeni hedef veya Reminders'a görev
 *   - journal → episodic-memory bugünün kayıtlarına ek
 *   - knowledge → KnowledgeStore'a Document
 *
 * POST /api/quick-capture { text: "...", type?: "auto" }
 */
const https = require('https');
const { exec, spawn } = require('child_process');
const path = require('path');

function osa(script, ms = 8000) {
  return new Promise((resolve) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: ms }, (err, stdout) => {
      resolve({ ok: !err, output: (stdout || '').trim() });
    });
  });
}

function callLLMJson(messages) {
  const apiKey = (process.env.TOGETHER_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const model = process.env.LLM_DEFAULT || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const payload = JSON.stringify({ model, messages, temperature: 0.2, response_format: { type: 'json_object' } });
  return new Promise((resolve) => {
    const req = https.request('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XJarvis-QuickCapture' },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const c = (j.choices?.[0]?.message?.content || '{}').trim().replace(/^```\w*\n?|\n?```$/g, '');
          resolve(JSON.parse(c));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
    req.write(payload); req.end();
  });
}

const SYS = `Sen XJarvis'in "quick capture" sınıflandırıcısısın. Kullanıcı kısa bir metin atar; sen bunun ne olduğunu söyler ve uygun başlık/içeriği üretirsin.

Kategoriler:
- "reminder" — vadesi olan iş ("yarın 14:00 ahmet'i ara")
- "task" — vadesi belirsiz ama yapılması gereken iş ("xjarvis'e webhook ekle")
- "note" — kayıt için fikir/cümle ("Aristoteles özetini yaz")
- "journal" — günlük girişi ("bugün moralim iyi, koştum")
- "knowledge" — bilgi parçası, sonra arama için ("Plaid sandbox keys: …")

Cevap:
{
  "category": "reminder|task|note|journal|knowledge",
  "title": "<kısa, max 80 char>",
  "body": "<orijinal metnin temizlenmiş hâli, kısa>",
  "due": "<varsa ISO datetime, yoksa boş>",
  "rationale": "<neden bu kategori, kısa>"
}`;

async function classify(text) {
  if (!text || !text.trim()) return null;
  return callLLMJson([
    { role: 'system', content: SYS },
    { role: 'user', content: text.trim() },
  ]);
}

async function dispatchToReminder({ title, body, due }) {
  const dueClause = due ? `, due date:date "${due}"` : '';
  const bodyEsc = (body || '').replace(/"/g, '\\"');
  const titleEsc = (title || '').replace(/"/g, '\\"');
  const script = `tell application "Reminders" to make new reminder with properties {name:"${titleEsc}", body:"${bodyEsc}"${dueClause}}`;
  return osa(script, 6000);
}

async function dispatchToNote({ title, body }) {
  const titleEsc = (title || 'XJarvis').replace(/"/g, '\\"');
  const bodyEsc = (body || '').replace(/"/g, '\\"').replace(/\n/g, '<br>');
  const script = `
    tell application "Notes"
      tell account "iCloud"
        make new note with properties {name:"${titleEsc}", body:"<h3>${titleEsc}</h3><p>${bodyEsc}</p>"}
      end tell
    end tell
  `;
  return osa(script, 8000);
}

async function dispatchToJournal({ body }) {
  // Append to today's journal note
  const today = new Date().toISOString().slice(0, 10);
  const titleEsc = `XJarvis Journal ${today}`;
  const bodyEsc = (body || '').replace(/"/g, '\\"').replace(/\n/g, '<br>');
  const stamp = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  // Try to find existing note, else create. AppleScript for "find or create":
  const script = `
    tell application "Notes"
      tell account "iCloud"
        set existing to notes whose name is "${titleEsc}"
        if (count of existing) > 0 then
          set targetNote to item 1 of existing
          set body of targetNote to (body of targetNote) & "<p><b>${stamp}</b> — ${bodyEsc}</p>"
        else
          make new note with properties {name:"${titleEsc}", body:"<h3>${titleEsc}</h3><p><b>${stamp}</b> — ${bodyEsc}</p>"}
        end if
      end tell
    end tell
  `;
  return osa(script, 10000);
}

async function dispatchToKnowledge({ title, body }) {
  // Push directly via the python sync helper (we have one already).
  return new Promise((resolve) => {
    const args = JSON.stringify([{
      doc_id: `quick:${Date.now()}`,
      content: body || title,
      source: 'quick_capture',
      doc_type: 'note',
      title: title || '',
      timestamp: new Date().toISOString(),
      metadata: {},
    }]);
    const proc = spawn(process.env.PYTHON_BIN || 'python3', [
      path.join(__dirname, 'sync-knowledge.py'), 'import',
    ], { env: { ...process.env, PYTHONPATH: process.env.OPENJARVIS_SRC || '' } });
    proc.stdin.write(args); proc.stdin.end();
    let out = '';
    let resolved = false;
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('close', () => {
      if (!resolved) {
        resolved = true;
        try { resolve(JSON.parse(out || '{}')); } catch { resolve({ ok: false }); }
      }
    });
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { proc.kill(); } catch {}
        resolve({ ok: false, error: 'timeout' });
      }
    }, 15000);
    proc.on('close', () => { clearTimeout(timer); });
  });
}

async function dispatchToTask({ title, body, due }) {
  // Lightweight: write as a Reminders entry too, but tagged "task"
  const titleEsc = `[task] ${(title || '').replace(/"/g, '\\"')}`;
  const dueClause = due ? `, due date:date "${due}"` : '';
  const bodyEsc = (body || '').replace(/"/g, '\\"');
  const script = `tell application "Reminders" to make new reminder with properties {name:"${titleEsc}", body:"${bodyEsc}"${dueClause}}`;
  return osa(script, 6000);
}

async function capture(text, { typeOverride } = {}) {
  if (!text || !text.trim()) return { ok: false, error: 'empty' };
  let decision = typeOverride
    ? { category: typeOverride, title: text.slice(0, 60), body: text, due: '', rationale: 'override' }
    : await classify(text);
  if (!decision || !decision.category) {
    decision = { category: 'note', title: text.slice(0, 60), body: text, due: '' };
  }

  let result;
  switch (decision.category) {
    case 'reminder': result = await dispatchToReminder(decision); break;
    case 'task':     result = await dispatchToTask(decision); break;
    case 'note':     result = await dispatchToNote(decision); break;
    case 'journal':  result = await dispatchToJournal(decision); break;
    case 'knowledge': result = await dispatchToKnowledge(decision); break;
    default:         result = await dispatchToNote(decision);
  }

  return {
    ok: !!(result && (result.ok || result.imported)),
    decision,
    target_result: result,
  };
}

function shouldHandle(url) { return url.startsWith('/api/quick-capture'); }
async function handleHttp(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(JSON.stringify({ error: 'POST only' })); return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const { text, type } = JSON.parse(body || '{}');
      const r = await capture(text, { typeOverride: type === 'auto' ? undefined : type });
      res.writeHead(200); res.end(JSON.stringify(r));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
  });
}

module.exports = { capture, shouldHandle, handleHttp };
