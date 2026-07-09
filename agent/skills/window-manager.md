---
name: window-manager
description: Pencere düzenle, tile, mission control, space geçişi
---

# Window Manager

Kullanıcı "Safari'yi sola at", "iki pencereyi yan yana koy", "tam ekran yap",
"mission control aç", "diğer space'e geç" derse:

## Tool akışı

- **Tek pencere konumla** → `window_tile(position)`
  - `left`, `right`, `top`, `bottom` (yarı ekran)
  - `top-left`, `top-right`, `bottom-left`, `bottom-right` (çeyrek ekran)
  - `maximize` (tam usable alan), `center` (ortala, %50 boyut)

- **Side-by-side iki uygulama** ("Safari ve Notes'u yan yana"):
  1. `open_app("Safari")` → `window_tile("left")`
  2. `open_app("Notes")` → `window_tile("right")`
  - Sıra önemli: önce uygulamaya geç (frontmost olsun), sonra tile

- **Manuel boyut** → `window_move(x, y, w, h)` mutlak piksel

- **Mission Control** → `mission_control(mode)` — `all`, `app`, `desktop`

- **Space geçişi** → `space_switch("next" | "prev")`

- **Pencere küçült** → `window_minimize()`

- **Hangi uygulamalar açık** → `window_list_apps()`

## İpuçları

- `window_tile` her zaman frontmost pencereye uygulanır. Yanlış uygulama
  öndeyse önce `open_app(...)` ile öne getir.
- Çoklu monitör: şu an primary screen'e göre çalışır.
- Bazı uygulamalar (Finder, Sistem Ayarları) `position`/`size` set'ini reddedebilir
  — o zaman ERROR döner, kullanıcıya bildir.

## Tipik istekler

- "Safari'yi sola, Cursor'u sağa" → 2× open_app + window_tile
- "Şu pencereyi büyült" → `window_tile("maximize")`
- "Workspace'i değiştir" → `space_switch("next")`
- "Tüm pencereleri göster" → `mission_control("all")`
