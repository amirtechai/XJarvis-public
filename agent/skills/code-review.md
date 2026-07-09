---
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
```
[satır N] [kategori] kısa başlık
açıklama (1-2 cümle)
önerilen değişiklik (varsa)
```

Sadece somut bulguları söyle — "iyi yazılmış" gibi genel yorum yapma.
Toplamda 5'ten fazla bulgu bulduysan en kritik 5'ini seç.