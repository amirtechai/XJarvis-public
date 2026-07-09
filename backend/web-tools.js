/**
 * Web yüzeyleri — kullanıcının authenticated dashboard'larını Playwright (headless)
 * ile açıp içeriğini okur. Oturumlar sessions/<site>.json (Mac'te bir kez login).
 * Araç: web_report({site, url?}).
 */
const fs = require('fs');
const path = require('path');
const SESS_DIR = path.join(__dirname, 'sessions');

// Kişiye özel dashboard listesi — backend/sessions/sites.json içine kendi
// sayfalarını { "kısaad": "https://..." } biçiminde ekle. Dosya yoksa boş kalır
// ve web_report aracı "site tanımlı değil" döner (repoda hiçbir kişisel URL yok).
function loadSites() {
  try { return JSON.parse(fs.readFileSync(path.join(SESS_DIR, 'sites.json'), 'utf-8')); }
  catch { return {}; }
}
const SITES = loadSites();

const sessionFile = (site) => path.join(SESS_DIR, `${site}.json`);

function loadBasicAuth() {
  try { return JSON.parse(fs.readFileSync(path.join(SESS_DIR, 'basic-auth.json'), 'utf-8')); }
  catch { return {}; }
}

const TOOLS = [
  { name: 'web_report', description: 'Kullanıcının kendi dashboard sayfasını aç ve içeriğini oku/raporla. site: backend/sessions/sites.json içinde tanımlı kısa adlardan biri. İstenirse url ile alt sayfa.',
    input_schema: { type: 'object', properties: { site: { type: 'string' }, url: { type: 'string' } }, required: ['site'] } },
];

const TOOL_IMPL = {
  web_report: async ({ site, url }) => {
    const target = url || SITES[site];
    if (!target) return 'bilinmeyen site: ' + site + ' (geçerli: ' + Object.keys(SITES).join(', ') + ')';
    let chromium;
    try { ({ chromium } = require('playwright')); } catch { return 'Playwright kurulu değil'; }
    const sf = sessionFile(site);
    const hasSession = fs.existsSync(sf);
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const ba = loadBasicAuth()[site];
      const ctxOpts = {};
      if (hasSession) ctxOpts.storageState = sf;
      if (ba && ba.username) ctxOpts.httpCredentials = { username: ba.username, password: ba.password };
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      await page.goto(target, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const title = await page.title().catch(() => '');
      const text = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
      await browser.close();
      if (!hasSession && !ba) return `⚠️ "${site}" için kayıtlı oturum/kimlik yok — login gerekiyor. Sayfa başlığı: ${title}`;
      const looksLoggedOut = text.length < 300 && /login|giri[şs]|sign in|password|[şs]ifre/i.test(title + ' ' + text);
      if (looksLoggedOut) return `⚠️ "${site}" oturumu düşmüş olabilir (login ekranı görünüyor). Yeniden login gerekebilir.`;
      return `📊 ${site} — ${title}\n\n${text}`;
    } catch (e) {
      await browser.close().catch(() => {});
      return `"${site}" okunamadı: ${e.message}`;
    }
  },
};

module.exports = { TOOLS, TOOL_IMPL, SITES };
