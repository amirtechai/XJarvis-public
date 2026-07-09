---
name: spotify-control
description: Spotify uygulamasını kontrol et (çal, durdur, sıradaki, ses)
---

# Spotify Control

Kullanıcı Spotify ile ilgili bir şey istediğinde bu skill'i kullan.

## Komut → Aksiyon haritası

| Kullanıcı isteği | Yapılacak |
|---|---|
| "çal", "müzik aç", "devam et" | `applescript('tell application "Spotify" to play')` |
| "durdur", "duraklat" | `applescript('tell application "Spotify" to pause')` |
| "sonraki", "geç" | `applescript('tell application "Spotify" to next track')` |
| "önceki", "geri" | `applescript('tell application "Spotify" to previous track')` |
| "ne çalıyor" | `applescript('tell application "Spotify" to (artist of current track) & " - " & (name of current track)')` |
| "sesi kıs N", "sesi N yap" | `applescript('tell application "Spotify" to set sound volume to N')` (N: 0-100) |

Spotify açık değilse önce `open_app("Spotify")` çağır, 2 saniye bekle, sonra komutu çalıştır.

Kullanıcıya kısa cevap ver: "Çalıyor.", "Durduruldu." gibi.
