---
name: focus
description: Focus mode — DND, dikkat dağıtan uygulamaları kapat, müzik başlat
---

# Focus Mode

Kullanıcı "odaklan", "focus aç", "rahatsız etmeyin moda al" derse:

## Tool

- `focus_start(close_apps=[…], music_app="Music"|"Spotify"|"", playlist="…")`
  - Default close_apps: Slack, Mail, Discord, Messages, Telegram, WhatsApp
  - DND için Shortcuts CLI'yi dener (kullanıcının yarattığı shortcut'lar)
- `focus_stop(reopen_apps=[…], stop_music=true)`
- `focus_status()` — DND ve müzik durumu

## DND için kurulum (kullanıcı bir kez yapmalı)

macOS'ta DND'yi script'le açmak için Shortcuts uygulamasında 2 shortcut yarat:

1. **xjarvis-focus-on**
   - Action: "Set Focus" → choose "Do Not Disturb" → Turn On
2. **xjarvis-focus-off**
   - Action: "Set Focus" → choose "Do Not Disturb" → Turn Off

Yarattıktan sonra `focus_start` / `focus_stop` DND'yi gerçekten açar/kapar.
Yoksa sadece app kapatma + müzik çalışır, DND mesajını "no matching shortcut" döner.

## Tipik istekler

- "Odaklanmak istiyorum, müzik aç" → `focus_start(music_app="Spotify")`
- "Bir saatlik focus" → `focus_start(...)` + 1 saat sonra `reminders_add` ile
  "focus bitir" reminder
- "Focus kapat" → `focus_stop(stop_music=true)`
- "Focus durumu nedir" → `focus_status()`

## İpuçları

- Kullanıcı sık focus istiyorsa `fact_remember("focus_music", "Spotify - Deep Focus")`
  yap, sonraki seferlerde otomatik kullan.
- Çalışma bitince `focus_stop(reopen_apps=["Slack","Mail"])` mutlaka yap, yoksa
  kullanıcı mesajları kaçırır.
