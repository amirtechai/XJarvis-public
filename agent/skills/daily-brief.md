---
name: daily-brief
description: Günaydın özeti — bir komutla hava, takvim ve haberler
---

# Daily Brief

Kullanıcı "günaydın", "bugün nasıl", "brief" derse:

Sırayla 4 kısa parça çek (parallel tool call kullan):
1. **Hava** — web_search("[şehir] hava bugün") veya mcp_fetch ile open-meteo
2. **Takvim** — applescript('tell application "Calendar" to get summary of events of calendar 1 whose start date is greater than (current date)')
3. **Mail** — varsa email-triage skill'ini invoke et
4. **Haber** — web_search("son dakika haberler [Türkiye/dünya]") top 3

Sonucu 4 kısa madde halinde sun, her satır en fazla 1 cümle. Sonunda "Başka?" diye sor.