/**
 * Hızlı sesli komut yönlendirici (LLM bypass).
 *
 * Sık kullanılan komutları regex ile yakalayıp doğrudan endpoint çağırır.
 * Bu sayede:
 *   - LLM çağrı maliyeti yok
 *   - 50-200ms cevap (LLM 1-3 sn)
 *   - Deterministic — yanlış tool seçimi olmaz
 *
 * Kullanım: router.js içinde, agent'a göndermeden önce kontrol edilir.
 * Eşleşirse {handled:true, text:"söyle"} döner; eşleşmezse null.
 */
const http = require('http');

function postLocal(path, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {});
    const req = http.request({
      host: '127.0.0.1', port: 3001, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
        catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.on('timeout', () => { req.destroy(); resolve({}); });
    req.write(payload); req.end();
  });
}

const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/[.,!?;:]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Pattern → handler. Pattern eşleşirse handler çalışır, kullanıcıya kısa cevap döner.
const ROUTES = [
  // Kamera
  {
    re: /\b(kamera(yı)?|webcam) (aç|aktif|on|göster)\b/,
    fn: async () => {
      // Toggle endpoint — durumu kontrol edip gerekirse aç
      await postLocal('/api/control/camera', {});
      return 'Kamera açıldı patron.';
    },
  },
  {
    re: /\b(kamera(yı)?|webcam) (kapat|kapa|pasif|off|gizle)\b/,
    fn: async () => {
      await postLocal('/api/control/camera', {});
      return 'Kamera kapatıldı patron.';
    },
  },
  // Mikrofon
  {
    re: /\b(mikrofon(u)?|mic) (kapat|sustur|off|kıs)\b/,
    fn: async () => {
      await postLocal('/api/control/mic', {});
      return 'Mikrofon kapatıldı.';
    },
  },
  // Ses kontrol — "ses" / "sesi" / "sesini" sözcüğü ZORUNLU
  // (Aksi halde "Safari'yi aç" gibi cümleleri yakalıyor)
  {
    re: /\b(sesi|sesini|ses) (aç|yükselt|artır|kaldır)\b/,
    fn: async () => {
      await postLocal('/api/control/volume', { delta: 15 });
      return 'Sesi yükselttim.';
    },
  },
  {
    re: /\b(sesi|sesini|ses) (kıs|azalt|düşür|indir)\b/,
    fn: async () => {
      await postLocal('/api/control/volume', { delta: -15 });
      return 'Sesi azalttım.';
    },
  },
  {
    re: /\b(sesi|sesini|ses) (sustur|kapat)\b|\bsessize al\b|\bmute\b/,
    fn: async () => {
      await postLocal('/api/control/volume', { level: 0 });
      return 'Sustum patron.';
    },
  },
  {
    re: /\b(sesi|sesini|ses) (tam|maksimum|max|sonuna kadar)\b/,
    fn: async () => {
      await postLocal('/api/control/volume', { level: 100 });
      return 'Ses tam, patron.';
    },
  },
  // Ses seviyesi sayısal — "sesi 50 yap"
  {
    re: /\bsesi (\d{1,3})(?:e|ye|ya|a)? (yap|ayarla|getir)\b/,
    fn: async (m) => {
      const lvl = Math.max(0, Math.min(100, parseInt(m[1], 10)));
      await postLocal('/api/control/volume', { level: lvl });
      return `Ses ${lvl} olarak ayarlandı.`;
    },
  },
  // YouTube
  {
    re: /\byou ?tube (aç|başlat)\b/,
    fn: async () => {
      await postLocal('/api/app/youtube', { action: 'play' });
      return 'YouTube açıyorum.';
    },
  },
  {
    re: /\b(durdur|duraklat|pause)\b.*(youtube|video|şarkı|müzik)|^(durdur|duraklat|pause)$/,
    fn: async () => {
      await postLocal('/api/app/youtube', { action: 'pause' });
      return 'Durdurdum.';
    },
  },
  {
    re: /\b(sonraki|sıradaki|next)\b.*(şarkı|video|track)|^(sonraki|next)$/,
    fn: async () => {
      await postLocal('/api/app/youtube', { action: 'next' });
      return 'Sonraki.';
    },
  },
  // Ekran/Kapatma
  {
    re: /\b(ekran(ı)?) (kapat|kilitle|uyut)\b/,
    fn: async () => {
      const { exec } = require('child_process');
      exec('pmset displaysleepnow', (err) => {
        if (err) console.error('[voice] display sleep failed:', err.message);
      });
      return 'Ekran kapatılıyor.';
    },
  },
  // Channel switch — "Bloomberg aç", "TV100 aç" vs.
  {
    re: /(?:^|\s)(tv\s?100|tgrt(?:\s?haber)?|cnbc(?:[\s-]?e)?|cnn\s?t(?:ü|u)rk|a\s?haber|halk\s?tv|tv\s?net|ntv|sky\s?news|sky|al\s?jazeera|cezire|dw)\s+(aç|açar mısın|geç|göster|izle|izlet|koy)(?:$|\s)/,
    fn: async (m) => {
      const { bus, EVENT_TYPES } = require('./events/bus');
      const raw = (m[1] || '').replace(/\s+/g, '').toLowerCase();
      const map = {
        'tv100': 'tv100',
        'tgrt': 'tgrt', 'tgrthaber': 'tgrt',
        'cnbc': 'cnbce', 'cnbce': 'cnbce', 'cnbc-e': 'cnbce',
        'cnnturk': 'cnnturk', 'cnntürk': 'cnnturk',
        'ahaber': 'ahaber',
        'halktv': 'halktv',
        'tvnet': 'tvnet',
        'ntv': 'ntv',
        'skynews': 'skynews', 'sky': 'skynews',
        'aljazeera': 'aljazeera', 'cezire': 'aljazeera',
        'dw': 'dw',
      };
      const id = map[raw] || raw;
      bus.emit(EVENT_TYPES.NAVIGATE, { path: '/news' }, 'system');
      setTimeout(() => bus.emit(EVENT_TYPES.CHANNEL_CHANGE, { id }, 'system'), 400);
      const reply = `Açıyorum patron.`;
      return reply;
    },
  },
  // Haber SAYFASINI AÇ — yalnız açma komutu. "haberlerde ne var / son 1 saatte
  // ne oldu" gibi İÇERİK SORULARI buraya TAKILMAZ → agent'a gidip gerçek cevap
  // (web_search/deep_research) verir.
  {
    re: /\bhaber(?:i|leri)?\s+(?:aç|göster|getir)(?=\s|$)|\bnews\s*mode/,
    fn: async () => {
      // SADECE yönlendir + reply döndür. RESPONSE_* emit ETME — router.js fast-route
      // handler'ı reply'ı zaten TTS'e gönderiyor; burada da emitlersek ÇİFT seslenir.
      const { bus, EVENT_TYPES } = require('./events/bus');
      try {
        if (EVENT_TYPES.NAVIGATE) {
          bus.emit(EVENT_TYPES.NAVIGATE, { path: '/news' }, 'system');
        } else {
          bus.emit('SERVICE_HEALTH_CHANGE', { service: 'navigate', status: '/news' }, 'system');
        }
      } catch { /* navigate best-effort */ }
      return 'Haberleri açıyorum patron.';
    },
  },
  // Dashboard / HUD'a dön (haberleri kapat dahil)
  {
    re: /\b(dashboard|hud|ana ekran)(a|e|ı|i)? (dön|aç|geri)\b|^geri dön$|\bhaberleri (kapat|kapa|gizle)\b|\bnews(?:i|u)? kapat\b/,
    fn: async () => {
      const { bus, EVENT_TYPES } = require('./events/bus');
      const reply = 'Kapatıyorum patron.';
      // Tersine slide animasyonu için query param gönder
      bus.emit(EVENT_TYPES.NAVIGATE, { path: '/dashboard', direction: 'back' }, 'system');
      return reply;
    },
  },
  // Model switch — "opus'a geç", "sonnet'e geç", "haiku ile dene", "gemini'ye geç"
  {
    re: /\b(opus|sonnet|haiku|gemini|flash|deepseek)('?[ae]|'?ya|'?ye|'?ı|'?i| ?ile)?\s+(geç|aktif|kullan|dene|yap|ayarla|seç)\b/,
    fn: async (m) => {
      const id = (m[1] || '').toLowerCase();
      await postLocal('/api/agent/model', { id });
      const labels = { opus: 'Opus 4.7', sonnet: 'Sonnet 4.6', haiku: 'Haiku 4.5', gemini: 'Gemini Flash', flash: 'Gemini Flash Lite', deepseek: 'DeepSeek' };
      return `${labels[id] || id}'e geçtim patron.`;
    },
  },
  // Scene navigation — world / cyber / creative / dev / trading
  {
    re: /\b(dünya\s*haritas[ıi]|world\s*watch|world\s*monitor)\b|\bdünya\s+(aç|göster)\b/,
    fn: async () => {
      const { bus, EVENT_TYPES } = require('./events/bus');
      bus.emit(EVENT_TYPES.NAVIGATE, { path: '/world' }, 'system');
      const reply = 'Dünya haritası açılıyor patron.';
      return reply;
    },
  },
  {
    re: /\b(cyber\s*moda|cyber\s*panel|iş\s*paneli)\b|\bcyber\s+(aç|göster|geç)\b/,
    fn: async () => {
      const { bus, EVENT_TYPES } = require('./events/bus');
      bus.emit(EVENT_TYPES.NAVIGATE, { path: '/cyber' }, 'system');
      const reply = 'Cyber paneli.';
      return reply;
    },
  },
  {
    re: /\b(kreatif\s*lab|creative\s*lab|reklam\s*üret)\b|\b(kreatif|creative)\s+(aç|göster|geç)\b/,
    fn: async () => {
      const { bus, EVENT_TYPES } = require('./events/bus');
      bus.emit(EVENT_TYPES.NAVIGATE, { path: '/creative' }, 'system');
      const reply = 'Kreatif lab.';
      return reply;
    },
  },
  {
    re: /\b(dev\s*moda|kod\s*paneli|developer)\b|\bdev\s+(aç|geç)\b/,
    fn: async () => {
      const { bus, EVENT_TYPES } = require('./events/bus');
      bus.emit(EVENT_TYPES.NAVIGATE, { path: '/dev' }, 'system');
      const reply = 'Dev paneli.';
      return reply;
    },
  },
  {
    re: /\b(trading\s*paneli|trading\s*floor|borsa\s*paneli)\b|\btrading\s+(aç|göster|geç)\b/,
    fn: async () => {
      const { bus, EVENT_TYPES } = require('./events/bus');
      bus.emit(EVENT_TYPES.NAVIGATE, { path: '/trading' }, 'system');
      const reply = 'Trading paneli.';
      return reply;
    },
  },
  // Saat / Tarih (LLM çağırmadan)
  {
    re: /^saat (kaç|nedir)\??$|^kaç saat$/,
    fn: async () => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      return `Saat ${h}:${m} patron.`;
    },
  },
  {
    re: /^(bugün(ün)? tarih(i)? (ne|nedir)|tarih (ne|nedir|kaç))\??$/,
    fn: async () => {
      const now = new Date();
      const months = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
      const days = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
      return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}, ${days[now.getDay()]} patron.`;
    },
  },
];

async function tryRoute(text) {
  const t = norm(text);
  if (!t) return null;
  for (const route of ROUTES) {
    const m = t.match(route.re);
    if (m) {
      // Ses komutları YALNIZ kısa, komut-niyetli söyleyişte tetiklensin.
      // Uzun sohbet cümlesinde "sesi/sesini" geçmesi Mac sesini kafasına göre
      // kısıp açmasın (kullanıcı şikayeti: "kafasına göre sesi kısıyor").
      if (route.re.source.includes('sesini') && t.split(' ').length > 5) continue;
      try {
        const reply = await route.fn(m);
        return { handled: true, reply, matched: route.re.toString() };
      } catch (e) {
        return { handled: true, reply: 'Bir hata oldu patron.', error: e.message };
      }
    }
  }
  return null;
}

module.exports = { tryRoute };
