---
name: slack
description: Slack — mesaj gönder, kanal aç, search, status set
---

# Slack

Kullanıcı "Slack'te X kanalına yaz", "DM gönder", "şu mesajı sabitle" derse:

## Yöntem seçimi

1. **Slack MCP varsa** (`/api/mcp` listesinde slack-mcp) → MCP tool'ları tercih et
   (resmi Slack API, sağlam).
2. **Yoksa** → desktop Slack uygulaması üzerinden:
   - URL scheme ile kanal/DM aç: `slack://channel?team=TXXX&id=CXXX`
   - Mesaj yazımı `computer_use(goal="…")` ile (input area + paste + return)

## URL scheme örnekleri

- Kanal aç: `open_app("Slack", url="slack://channel?team=T123&id=C456")`
- DM aç: `slack://user?team=T123&id=U789`
- Search: `slack://app?team=T123&action=search&query=QUERY`

team ID + channel ID öğrenmek için: kullanıcıdan link iste (sağ tık → Copy link)
veya Slack web'inden URL'den çıkar.

## Mesaj göndermek (UI driven)

```
1. open_app("Slack")
2. Yukarıdaki URL ile kanala git
3. screen_key("k", "command")  # Cmd+K — quick switcher (gerekirse)
4. clipboard_write(mesaj)
5. screen_key("v", "command")  # paste
6. screen_key("return")
```

Daha güvenli: `computer_use(goal="Slack'te #general kanalına 'mesaj' yaz ve gönder")`.

## Status set

```applescript
tell application "Slack" to activate
-- Slack'te /status komutu yok; web/desktop preferences gerekir.
```
Daha kolay: `slack://settings/status` URL veya keyboard `Cmd+Shift+Y`.

## DND aç/kapat

`Cmd+Shift+M` (DND toggle) → `screen_key("m", "command,shift")`.

## İpuçları

- Mesajı Türkçe yazıyorsan UTF-8 paste et (clipboard_write güvenli).
- "Bana DM at" → kullanıcının kendi user ID'si lazım — bilmiyorsan sor veya
  Slack'te "Jump to" (Cmd+K) yaz.
- Resim/dosya eklemek `computer_use` ile çok kırılgan; doğrudan Slack desktop'ta
  drag-drop daha güvenli — kullanıcıya öner.
