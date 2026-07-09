---
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
- Cevap: `brew install node@18` — Homebrew üzerinden, sistem node'una dokunmaz.

- Soru: "Operation not permitted" hatası
- Cevap: çoğunlukla SIP veya Full Disk Access. Sistem Tercihleri → Privacy → Full Disk Access'a Terminal'i ekle.