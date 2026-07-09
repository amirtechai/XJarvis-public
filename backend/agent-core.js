/**
 * XJarvis agentic çekirdek v1 — kalıcı hafıza + hatırlatıcı/alarm + genişletilmiş araçlar.
 * server.js'in mevcut better-sqlite3 `db`'sini ve lite-agent tool döngüsünü kullanır.
 *
 *   const core = require('./agent-core')(db);
 *   TOOLS.push(...core.TOOLS); Object.assign(TOOL_IMPL, core.TOOL_IMPL);
 *   // runServerAgent: system: core.buildSystem(SYS_PROMPT)
 *   core.startScheduler(telegramSend);
 */
const sources = require('./daily-sources');
const daily = require('./daily-brief');

module.exports = function createCore(db) {
  const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact TEXT NOT NULL, tag TEXT, ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL, due_ts INTEGER NOT NULL, chat_id TEXT,
      fired INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rem_due ON reminders(fired, due_ts);
  `);

  // --- Hafıza ---------------------------------------------------------------
  const remember = (fact, tag) => {
    db.prepare('INSERT INTO memory(fact, tag, ts) VALUES (?,?,?)').run(String(fact).slice(0, 500), tag || null, Date.now());
    return 'kaydedildi';
  };
  const recallAll = () => db.prepare('SELECT id, fact FROM memory ORDER BY ts DESC LIMIT 50').all();
  const recall = (q) => {
    const rows = recallAll();
    if (!q) return rows;
    const ql = String(q).toLowerCase();
    return rows.filter((r) => r.fact.toLowerCase().includes(ql));
  };
  const forget = (id) => {
    const r = db.prepare('DELETE FROM memory WHERE id=?').run(Number(id));
    return r.changes ? 'unutuldu' : 'bulunamadı';
  };

  // --- Hatırlatıcı / alarm --------------------------------------------------
  const addReminder = (text, whenIso, chatId) => {
    let iso = String(whenIso || '').trim();
    if (iso && !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso)) iso += '+03:00'; // ofset yoksa Europe/Istanbul varsay
    const due = Date.parse(iso);
    if (!due || isNaN(due)) return { ok: false, msg: 'geçersiz tarih (ISO 8601 ver)' };
    const r = db.prepare('INSERT INTO reminders(text, due_ts, chat_id, ts) VALUES (?,?,?,?)')
      .run(String(text).slice(0, 500), due, chatId || TG_CHAT, Date.now());
    return { ok: true, id: r.lastInsertRowid, due };
  };
  const listReminders = () => db.prepare("SELECT id, text, due_ts FROM reminders WHERE fired=0 ORDER BY due_ts ASC LIMIT 30").all();
  const cancelReminder = (id) => {
    const r = db.prepare('UPDATE reminders SET fired=1 WHERE id=? AND fired=0').run(Number(id));
    return r.changes ? 'iptal edildi' : 'bulunamadı';
  };
  const dueReminders = () => db.prepare("SELECT * FROM reminders WHERE fired=0 AND due_ts<=? ORDER BY due_ts ASC LIMIT 10").all(Date.now());
  const markFired = (id) => db.prepare('UPDATE reminders SET fired=1 WHERE id=?').run(id);

  const fmtDue = (ms) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' });

  // --- Araç tanımları (Anthropic tool schema) -------------------------------
  const TOOLS = [
    { name: 'remember_fact', description: 'Kullanıcı hakkında kalıcı bir bilgi/tercih kaydet (örn. "patron sabah 7 kalkar", "eşinin adı X"). Kullanıcı "şunu hatırla/unutma" dediğinde veya önemli kalıcı bir tercih öğrendiğinde kullan.',
      input_schema: { type: 'object', properties: { fact: { type: 'string' }, tag: { type: 'string' } }, required: ['fact'] } },
    { name: 'recall_facts', description: 'Kayıtlı kullanıcı bilgilerini ara/getir. Boş sorgu hepsini döndürür.',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } } },
    { name: 'forget_fact', description: 'Kayıtlı bir bilgiyi id ile sil.',
      input_schema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
    { name: 'set_reminder', description: 'Bir hatırlatıcı/alarm kur. when ISO 8601 formatında ve +03:00 ofsetli olmalı (Europe/Istanbul). "Şu an" zamanına göre hesapla. Örn. "yarın 09:00" -> 2026-06-08T09:00:00+03:00.',
      input_schema: { type: 'object', properties: { text: { type: 'string' }, when: { type: 'string', description: 'ISO 8601 datetime' } }, required: ['text', 'when'] } },
    { name: 'list_reminders', description: 'Bekleyen hatırlatıcıları listele.',
      input_schema: { type: 'object', properties: {} } },
    { name: 'cancel_reminder', description: 'Bir hatırlatıcıyı id ile iptal et.',
      input_schema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
    { name: 'get_markets', description: 'Canlı piyasa özeti: BIST/dünya borsaları, Dolar/Euro/TL, gram & ons altın, top 5 kripto.',
      input_schema: { type: 'object', properties: {} } },
    { name: 'get_prayer_times', description: 'Balıkesir için bugünkü namaz vakitleri + hicri tarih.',
      input_schema: { type: 'object', properties: {} } },
    { name: 'get_daily_brief', description: 'Tam günlük brifing: namaz, ayet, hadis, piyasa, haber, motivasyon.',
      input_schema: { type: 'object', properties: {} } },
  ];

  const TOOL_IMPL = {
    remember_fact: async ({ fact, tag }) => remember(fact, tag),
    recall_facts: async ({ query }) => {
      const rows = recall(query);
      return rows.length ? rows.map((r) => `#${r.id}: ${r.fact}`).join('\n') : 'kayıt yok';
    },
    forget_fact: async ({ id }) => forget(id),
    set_reminder: async ({ text, when }) => {
      const r = addReminder(text, when);
      return r.ok ? `Hatırlatıcı kuruldu (#${r.id}) — ${fmtDue(r.due)}` : r.msg;
    },
    list_reminders: async () => {
      const rows = listReminders();
      return rows.length ? rows.map((r) => `#${r.id}: ${r.text} — ${fmtDue(r.due_ts)}`).join('\n') : 'bekleyen hatırlatıcı yok';
    },
    cancel_reminder: async ({ id }) => cancelReminder(id),
    get_markets: async () => daily.composeMarkets(),
    get_prayer_times: async () => daily.composePrayer(),
    get_daily_brief: async () => daily.composeFull(),
  };

  // --- Sistem prompt'a hafıza + zaman enjeksiyonu ---------------------------
  function nowIstanbul() {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Istanbul' }); // "2026-06-07 14:30:00"
  }
  function buildSystem(base) {
    const facts = recallAll();
    let s = `${base}\n\nŞu an: ${nowIstanbul()} (Europe/Istanbul, UTC+03:00). Hatırlatıcı (set_reminder) kurarken ISO 8601'i +03:00 ofsetiyle ver, örn. 2026-06-08T09:00:00+03:00.`;
    if (facts.length) {
      s += `\n\nKULLANICI HAKKINDA HATIRLADIKLARIN:\n` + facts.map((f) => `- (#${f.id}) ${f.fact}`).join('\n');
    }
    const rem = listReminders();
    if (rem.length) s += `\n\nBEKLEYEN HATIRLATICILAR: ${rem.length} adet.`;
    s += `\n\nDANIŞMAN KİMLİĞİN: Sadece soruları yanıtlama; Patron'a kendi içgörülerini ve tavsiyelerini de sun. Düşünce merkezin Carl Jung psikolojisi (bireyleşme, gölge, persona, benlik/Self, anlam arayışı) ile İmam Gazâlî tasavvuf-ahlakının (nefs muhasebesi, ihlas, kalbin arınması, istikamet, tefekkür) SENTEZİDİR. Hatırladığın bilgileri kullanarak kişisel, derin ama kısa ve UYGULANABİLİR tavsiye ver; her önemli tavsiyeyi bu iki kaynaktan birine demirle. Dalkavukluk yapma; dürüst, yapıcı ve sıcak ol.`;
    s += `\n\nARAŞTIRMA: Kullanıcı araştır/derin araştır/incele derse veya bir görsel/ekran görüntüsü/link verip araştırma isterse; web_search aracını FARKLI sorgularla 2-4 kez kullan, gerekirse fetch_url ile kaynakları aç, sonra DERLENMİŞ ve kaynaklı net bir özet sun. Tek aramayla yetinme.`;
    return s;
  }

  // --- Hatırlatıcı zamanlayıcı ----------------------------------------------
  function startScheduler(telegramSend) {
    setInterval(() => {
      try {
        for (const r of dueReminders()) {
          markFired(r.id);
          telegramSend(`⏰ *Hatırlatma:* ${r.text}`, r.chat_id).catch(() => {});
        }
      } catch (e) { console.warn('[core/reminder]', e.message); }
    }, 20_000);
    console.log('[core] agentic çekirdek aktif (hafıza + hatırlatıcı + araçlar)');
  }

  return { TOOLS, TOOL_IMPL, buildSystem, startScheduler };
};
