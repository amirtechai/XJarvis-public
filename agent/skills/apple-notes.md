---
name: apple-notes
description: Apple Notes'a not ekle veya not ara (silme yapamazsın)
---

# Apple Notes

Kullanıcı "şunu Notes'a yaz", "şu konuda bir not aç", "Notes'da şu kelimeyi ara" gibi komutlar verirse:

## Not eklemek

```bash
curl -s -X POST http://localhost:3001/api/app/notes/add \
  -H 'Content-Type: application/json' \
  -d '{"title":"<başlık>","body":"<içerik>","folder":"<opsiyonel klasör adı>"}'
```

## Not aramak

```bash
curl -s "http://localhost:3001/api/app/notes/find?q=<query>"
```

Cevap: `{"matches": [{"title":"...", "modified":"..."}], "count": N}` — bulunan notların başlığı ve değişiklik tarihi.

## ÖNEMLİ — KISITLAMALAR

- **NOT SİLME ÖZELLİĞİ YOK.** Kullanıcı "şu notu sil" derse "Bu yetkiye sahip değilim efendim, Apple Notes'tan kendiniz silebilirsiniz" şeklinde yanıt ver. ASLA silmek için başka yol arama (shell, dosya, vb.).
- Düzenleme/append yok — sadece yeni not yaratmak ve aramak. Mevcut notu değiştirmek için kullanıcı manuel açmalı.
- Klasör belirtilmemişse default iCloud Notes ana dizinine eklenir.

## Tipik akış

Kullanıcı: "Aristoteles'in 4 sebep teorisini yaz, fizik klasörüne ekle."
→ shell_exec ile `notes/add`'e POST: title="Aristoteles 4 Sebep", body="<açıklama>", folder="Fizik"
→ "Eklendim efendim" diye onay ver.

Kullanıcı: "geçen ay yazdığım MCP notunu bulur musun?"
→ shell_exec ile `notes/find?q=MCP`
→ Bulunan notların başlıklarını söyle, ilgili olabilecekleri vurgula.
