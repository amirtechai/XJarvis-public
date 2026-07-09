---
name: browser
description: Safari/Chrome sekme kontrolü, URL aç, form doldur, JS çalıştır
---

# Browser

Kullanıcı "Safari'de openrouter.ai aç", "şu sekmeyi kapat", "form doldur",
"hangi sekmeler açık" derse:

## Tipik akışlar

- **URL aç** → `browser_open(url, browser="safari", new_tab=true)`
  - Default browser: safari. `chrome | arc | brave | edge` da olur.
  - "şu siteyi mevcut sekmede aç" → `new_tab=false`

- **Açık sekmeleri gör** → `browser_tabs("safari")` → JSON list
  - "X sitesinde miyim" / "kaç sekme açık" sorularına burası bakar.

- **Sekme kapat**:
  - aktif sekme → `browser_close_tab("safari", window=1, index=0)`
  - belirli sekme → `browser_close_tab(..., index=3)`

- **Sekme değiştir** → `browser_switch_tab(browser, window=1, index=2)`

- **JS çalıştır** → `browser_js(browser, code)` (return string)
  - Önkoşul: tarayıcı menüsünden "Allow JavaScript from Apple Events" aktif olmalı
  - "Bu sayfanın başlığı?" → `browser_js("safari", "document.title")`

- **Form doldur** → `browser_fill(browser, selector, value)` (CSS selector)
- **Tıkla** → `browser_click(browser, selector)`

## Kompozit örnek

> "GitHub'da search bar'a 'XJarvis' yaz, ara"

1. `browser_open("https://github.com", "safari")`
2. ~1s bekle (sayfa yüklensin)
3. `browser_fill("safari", "input[name='q']", "XJarvis")`
4. `browser_js("safari", "document.querySelector('form').submit()")`

## İpuçları

- Selector emin değilsen önce `browser_js("safari", "[...document.querySelectorAll('input')].map(e=>e.outerHTML).join('\\n')")` ile DOM'u keşfet.
- Bazı SPA'larda `value=` set yetmez; `input` event de fire et (zaten browser_fill bunu yapıyor).
- `browser_js` ERROR: 'NotAllowed' dönerse → kullanıcıya "Tarayıcıda Develop → Allow JavaScript from Apple Events'i aç" demesi gerek.
- Karmaşık form/UI için `computer_use(goal=...)` daha sağlam (vision-driven).
