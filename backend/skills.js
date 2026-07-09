/**
 * Skill marketplace — curated skill content + local CRUD against agent/skills/.
 *
 *   GET    /api/skills/presets   → built-in skills (id, label, body)
 *   GET    /api/skills/installed → list of files currently in agent/skills/
 *   POST   /api/skills/install   { id }   ← writes preset body to disk
 *   POST   /api/skills/save      { name, content }   ← user-authored skill
 *   DELETE /api/skills           { name }
 */
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', 'agent', 'skills');

// Built-in skill library — markdown bodies that ship as installable presets.
const PRESETS = [
  {
    id: 'email-triage',
    label: 'Email Triage',
    description: 'Gelen e-postaları öncelik bazlı sınıflandır + kısa özet üret.',
    body: `---
name: email-triage
description: Gmail/Outlook gelen kutusunu önceliğe göre sınıflandır
---

# Email Triage

Kullanıcı "mail bak", "yeni mailim var mı", "bugün ne geldi" derse:

1. mcp_filesystem veya doğrudan shell_exec ile mail dump'ını oku (Apple Mail için: ~/Library/Mail)
2. Son 24 saat içindeki mailleri al, gönderene göre grupla
3. 4 kategoriye ayır:
   - **Aksiyon** — yanıt gerektiren, deadline içeren
   - **Bilgi** — okunabilir, yanıt opsiyonel
   - **Toplantı** — invite, calendar
   - **Atla** — newsletter, otomatik bildirim

Her kategori için en fazla 3 satır özet ver. Türkçe konuş, kısa tut.`,
  },
  {
    id: 'meeting-notes',
    label: 'Meeting Notes',
    description: 'Toplantı sırasında notları yapılandır, action item çıkar.',
    body: `---
name: meeting-notes
description: Toplantı transkriptinden notlar, kararlar ve action item'lar üret
---

# Meeting Notes

Kullanıcı bir transkript yapıştırdığında veya "bu toplantının özetini yap" derse:

Çıktı formatı:
\`\`\`
## Konu
[1 cümle]

## Katılımcılar
- ...

## Kararlar
- [karar 1]
- [karar 2]

## Action Items
- [ ] @kim — [ne yapacak] (ne zamana kadar)
\`\`\`

Action item'larda kişi atanmamışsa "@unassigned" yaz. Tarih belirsizse "TBD".
Her action item için fact_remember ile sakla: \`fact_remember('action_item_<timestamp>', '<açıklama>')\``,
  },
  {
    id: 'code-review',
    label: 'Code Review',
    description: 'Bir dosyayı oku, sorunları + öneri tag\'leriyle yorumla.',
    body: `---
name: code-review
description: Kod dosyasını incele ve yapısal/güvenlik/performans sorunlarını bildir
---

# Code Review

Kullanıcı bir dosyayı incele dediğinde:

1. file_read ile dosyayı al
2. Bulguları üç kategoriye ayır:
   - 🐛 **bug** — fonksiyonel hata, edge case
   - ⚠️ **risk** — güvenlik, performans, race condition
   - ✨ **suggest** — okunabilirlik, isim, refactor

Format:
\`\`\`
[satır N] [kategori] kısa başlık
açıklama (1-2 cümle)
önerilen değişiklik (varsa)
\`\`\`

Sadece somut bulguları söyle — "iyi yazılmış" gibi genel yorum yapma.
Toplamda 5'ten fazla bulgu bulduysan en kritik 5'ini seç.`,
  },
  {
    id: 'terminal-helper',
    label: 'Terminal Helper',
    description: 'Shell hatalarını ve "nasıl yaparım" sorularını çöz.',
    body: `---
name: terminal-helper
description: Terminal hatası alındığında veya komut bilinmediğinde
---

# Terminal Helper

Kullanıcı bir hata mesajı yapıştırdığında veya "X'i nasıl yaparım" dediğinde:

1. shell_exec ile gerekirse mevcut durumu kontrol et (which, ls, brew list, vs.)
2. Tek satır cevap: yapılacak komut + neden
3. Riskli komutsa (rm, sudo, format) önce uyar

Örnek:
- Soru: "node 18'i nasıl kuruyorum"
- Cevap: \`brew install node@18\` — Homebrew üzerinden, sistem node'una dokunmaz.

- Soru: "Operation not permitted" hatası
- Cevap: çoğunlukla SIP veya Full Disk Access. Sistem Tercihleri → Privacy → Full Disk Access'a Terminal'i ekle.`,
  },
  {
    id: 'daily-brief',
    label: 'Daily Brief',
    description: 'Sabah özeti — hava, ajanda, mail, haberler.',
    body: `---
name: daily-brief
description: Günaydın özeti — bir komutla hava, takvim ve haberler
---

# Daily Brief

Kullanıcı "günaydın", "bugün nasıl", "brief" derse:

Sırayla 4 kısa parça çek (parallel tool call kullan):
1. **Hava** — web_search("[şehir] hava bugün") veya mcp_fetch ile open-meteo
2. **Takvim** — applescript('tell application "Calendar" to get summary of events of calendar 1 whose start date is greater than (current date)')
3. **Mail** — varsa email-triage skill'ini invoke et
4. **Haber** — web_search("son dakika haberler [Türkiye/dünya]") top 3

Sonucu 4 kısa madde halinde sun, her satır en fazla 1 cümle. Sonunda "Başka?" diye sor.`,
  },
];

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function listInstalled() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({
      name: f.replace(/\.md$/, ''),
      file: f,
      size: fs.statSync(path.join(SKILLS_DIR, f)).size,
    }));
}

async function presetsHandler(req, res) {
  const installed = new Set(listInstalled().map((s) => s.name));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    presets: PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      installed: installed.has(p.id),
    })),
  }));
}

async function installedHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ skills: listInstalled() }));
}

async function fileHandler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const name = String(url.searchParams.get('name') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!name) { res.writeHead(400); res.end(); return; }
  const file = path.join(SKILLS_DIR, `${name}.md`);
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const content = fs.readFileSync(file, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, name, content }));
}

async function installHandler(req, res) {
  let body;
  try { body = await readJson(req); }
  catch { res.writeHead(400); res.end('bad json'); return; }
  const preset = PRESETS.find((p) => p.id === body.id);
  if (!preset) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unknown preset' }));
    return;
  }
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const file = path.join(SKILLS_DIR, `${preset.id}.md`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, preset.body);
  fs.renameSync(tmp, file);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, id: preset.id, restart_required: true }));
}

async function saveHandler(req, res) {
  let body;
  try { body = await readJson(req); }
  catch { res.writeHead(400); res.end('bad json'); return; }
  const name = String(body.name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const content = String(body.content || '');
  if (!name || !content) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'name + content required' }));
    return;
  }
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const file = path.join(SKILLS_DIR, `${name}.md`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, name, restart_required: true }));
}

async function deleteHandler(req, res) {
  let body;
  try { body = await readJson(req); }
  catch { res.writeHead(400); res.end(); return; }
  const name = String(body.name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!name) { res.writeHead(400); res.end(); return; }
  const file = path.join(SKILLS_DIR, `${name}.md`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, name, restart_required: true }));
}

function handleHttp(req, res) {
  if (!req.url.startsWith('/api/skills')) return null;
  if (req.method === 'GET' && req.url === '/api/skills/presets')   return presetsHandler(req, res);
  if (req.method === 'GET' && req.url === '/api/skills/installed') return installedHandler(req, res);
  if (req.method === 'GET' && req.url.startsWith('/api/skills/file')) return fileHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/skills/install')  return installHandler(req, res);
  if (req.method === 'POST' && req.url === '/api/skills/save')     return saveHandler(req, res);
  if (req.method === 'DELETE' && req.url === '/api/skills')        return deleteHandler(req, res);
  res.writeHead(404);
  res.end();
  return undefined;
}

module.exports = { handleHttp };
