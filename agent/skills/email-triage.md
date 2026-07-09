---
name: email-triage
description: Gmail/Outlook gelen kutusunu önceliğe göre sınıflandır
---

# Email Triage

Kullanıcı "mail bak", "yeni mailim var mı", "bugün ne geldi" derse:

1. mcp_filesystem veya doğrudan shell_exec ile mail dump'ını oku (Apple Mail için: ~/Library/Mail)
2. Son 24 saat içindeki mailleri al, gönderene göre grupla
3. 4 kategoriye ayır:
   - **Aksiyon** — yanıt gerektiren, deadline içeren
   - **Bilgi** — okunabilir, yanıt opsiyonel
   - **Toplantı** — invite, calendar
   - **Atla** — newsletter, otomatik bildirim

Her kategori için en fazla 3 satır özet ver. Türkçe konuş, kısa tut.