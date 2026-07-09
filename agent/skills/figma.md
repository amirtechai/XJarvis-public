---
name: figma
description: Figma desktop — dosya aç, frame export, plugin, link paylaş
---

# Figma

Kullanıcı "Figma'da şu dosyayı aç", "şu frame'i export et", "tasarım linkini al" derse:

## Dosya aç

- URL ile aç (en güvenilir): `browser_open("https://www.figma.com/file/<KEY>/<NAME>", "safari")`
- Desktop app'te: `open_app("Figma", url="figma://file/<KEY>")`
- Yeni boş dosya: `figma://newfile`

## Sık kullanılan kısayollar

| Eylem | Kısayol | Tool |
|-------|---------|------|
| Frame seç | `F` | `screen_key("f")` |
| Component | `K` | `screen_key("k")` |
| Pen | `P` | `screen_key("p")` |
| Zoom fit | `Shift+1` | `screen_key("1", "shift")` |
| Zoom 100% | `Shift+0` | `screen_key("0", "shift")` |
| Outline | `Cmd+Shift+O` | `screen_key("o", "command,shift")` |
| Layers panel | `Alt+1` | `screen_key("1", "option")` |
| Comment | `C` | `screen_key("c")` |
| Pan (boşluk basılı) | `space` | tut |

## Export

UI: seç → Export panel (sağda) → `Cmd+Shift+E` → format seç → Export.

`screen_key("e", "command,shift")` ile dialog aç, sonra `computer_use` ile
"format PNG seç ve Export'a bas" yaptır.

## Link paylaş

- "Copy link" — `Cmd+L` (`screen_key("l", "command")`) → `clipboard_read()` ile linki al.
- Frame linki: frame seçili + Cmd+L → frame'in derin linkini verir.

## Plugin çalıştır

`Cmd+/` → quick actions → plugin adını yaz. `screen_key("/", "command")` +
`screen_type("plugin name")` + `screen_key("return")`.

## Tipik istekler

- "Şu Figma linkini aç" → `browser_open(url, "safari")` (desktop'a göre web
  daha hızlı yüklenir genelde)
- "Bu frame'in linkini ver" → kullanıcıdan seçimi onayla, Cmd+L, clipboard oku
- "PNG export" → Cmd+Shift+E + `computer_use(goal="Export Frame as PNG and save to ~/Desktop")`

## İpuçları

- Figma'nın AppleScript dictionary'si yok — her şey UI driven veya URL scheme
- "Tasarım inceleme" istekleri için screenshot al + `vision_analyze`
- Library/team paneli için `Cmd+Alt+O` (Assets)
