---
name: meeting-notes
description: Toplantı transkriptinden notlar, kararlar ve action item'lar üret
---

# Meeting Notes

Kullanıcı bir transkript yapıştırdığında veya "bu toplantının özetini yap" derse:

Çıktı formatı:
```
## Konu
[1 cümle]

## Katılımcılar
- ...

## Kararlar
- [karar 1]
- [karar 2]

## Action Items
- [ ] @kim — [ne yapacak] (ne zamana kadar)
```

Action item'larda kişi atanmamışsa "@unassigned" yaz. Tarih belirsizse "TBD".
Her action item için fact_remember ile sakla: `fact_remember('action_item_<timestamp>', '<açıklama>')`