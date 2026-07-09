---
name: youtube-control
description: YouTube'u kontrol et — ara, oynat, duraklat, ses, playlist'e ekle
---

# YouTube control

Kullanıcı "şu videoyu YouTube'da bul/aç", "şarkıyı duraklat", "sesi aç/kıs", "videoyu playlist'e kaydet", "fullscreen yap" gibi komutlar verirse:

`shell_exec` ile `curl -X POST http://localhost:3001/api/app/youtube` çağır:

```bash
# arama (sadece arama sayfasını açar)
curl -s -X POST http://localhost:3001/api/app/youtube \
  -H 'Content-Type: application/json' \
  -d '{"action":"search","query":"<sorgu>"}'

# arama + ilk sonucu oynat
curl -s -X POST http://localhost:3001/api/app/youtube \
  -H 'Content-Type: application/json' \
  -d '{"action":"first_result_play","query":"<sorgu>"}'

# play/pause / next / prev
curl -s -X POST http://localhost:3001/api/app/youtube -H 'Content-Type: application/json' -d '{"action":"play_pause"}'
curl -s -X POST http://localhost:3001/api/app/youtube -H 'Content-Type: application/json' -d '{"action":"next"}'
curl -s -X POST http://localhost:3001/api/app/youtube -H 'Content-Type: application/json' -d '{"action":"prev"}'

# ses kontrolü
curl -s -X POST http://localhost:3001/api/app/youtube -H 'Content-Type: application/json' -d '{"action":"volume_up"}'
curl -s -X POST http://localhost:3001/api/app/youtube -H 'Content-Type: application/json' -d '{"action":"volume_down"}'
curl -s -X POST http://localhost:3001/api/app/youtube -H 'Content-Type: application/json' -d '{"action":"mute"}'

# fullscreen
curl -s -X POST http://localhost:3001/api/app/youtube -H 'Content-Type: application/json' -d '{"action":"fullscreen"}'

# playlist'e kaydet
curl -s -X POST http://localhost:3001/api/app/youtube \
  -H 'Content-Type: application/json' \
  -d '{"action":"save_to_playlist","playlist":"<playlist adı>"}'
```

Notlar:
- YouTube'un Chrome veya Safari'de açık olması gerek (önce "first_result_play" veya "search" ile aç).
- Volume up/down YouTube tabının focus'lu olmasını gerektirir; modül otomatik focus yapar.
- Save to playlist için playlist adı tam eşleşmeli (Türkçe ad varsa onu yaz).
- Sonucu kullanıcıya kısa Türkçe cümleyle bildir: "Açtım, oynatıyorum efendim."
