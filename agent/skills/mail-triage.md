---
name: mail-triage
description: Apple Mail.app inbox'ını günlük olarak özetleyip aksiyon önerisi çıkar
---

# Mail Triage

Kullanıcı "mailleri kontrol et", "inbox triage", "okunmamışları göster", "günün özeti" gibi şeyler istediğinde bu akışı izle.

## Akış

1. `mail_unread_count()` — kaç tane okunmamış var
2. `mail_recent(limit=10, unread_only=True)` — son 10 okunmamışı al
3. Sonuçları 4 kovaya ayır:
   - **Acil**: kişisel/iş, son 24 saat, soru veya deadline içeriyor
   - **Bilgi**: bültenler, fatura, otomatik bildirim
   - **Reklam**: pazarlama, promosyon, "üye ol", "%X indirim"
   - **Şüpheli**: tanımadık gönderici + linkli/eklenti
4. Acil olanlar için her biri için: 1-2 cümle özet + önerilen aksiyon (yanıtla / arşivle / ertele)
5. Reklam ve şüpheli olanları **otomatik silme** — sadece listele, kullanıcı onayı bekle
6. Eğer kullanıcı "X'e cevap yaz" derse → `mail_reply(index, body, send_now=False)` ile **draft** oluştur (asla `send_now=True` deme, kullanıcı manuel göndersin)

## Çıktı formatı

```
📧 Inbox: {unread} okunmamış

🔴 Acil ({count})
1. [Kişi/Şirket] — Konu (özet, aksiyon)
2. ...

📰 Bilgi ({count})
- ...

🛒 Reklam ({count})
- ...

⚠️ Şüpheli ({count})
- ...

Hangisine yanıt vereyim?
```

## Kurallar

- **Asla mail silme.** Sadece öner, kullanıcı `mail_reply` veya manuel halleder
- **Asla `send_now=True` kullanma.** Tüm yanıtlar draft olarak Mail.app'te açılır
- Türkçe yaz, kısa tut, kullanıcının zamanını harcama
- Inbox 0 ise: "Inbox temiz." de ve dur
