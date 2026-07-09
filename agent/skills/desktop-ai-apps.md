---
name: desktop-ai-apps
description: ChatGPT/Claude/Gemini/Kimi/Qwen masaüstü uygulamasına sesli komutla prompt gönder
---

# Desktop AI app kontrolü

Kullanıcı "şunu ChatGPT'ye sor", "Gemini'ye gönder", "Claude'a anlat" gibi komutlar verirse o uygulamaya prompt'u clipboard üzerinden yapıştırıp gönder.

```bash
curl -s -X POST http://localhost:3001/api/app/ai \
  -H 'Content-Type: application/json' \
  -d '{"app":"chatgpt|claude|gemini|kimi|qwen","prompt":"<kullanıcının söylemek istediği her şey>"}'
```

İpuçları:
- App önce Cmd+N ile yeni sohbet açar, sonra clipboard'dan paste eder, sonra Enter'a basar.
- macOS Privacy → Automation altında ilgili AI app'in tıklamasının onaylı olması gerek.
- Kullanıcı açıkça hangi AI'a göndermek istediğini söylemelidir; söylemediyse hangi AI'da daha iyi cevap çıkacağını sor.
- İşlem sonrası kullanıcıya "Gönderdim efendim, cevabı orada görebilirsiniz" gibi kısa onay ver.

Tipik kullanım örnekleri:
- "Şu kodu Claude'a göster ve refactor öner" → app=claude, prompt="Aşağıdaki kodu refactor edip açıkla:\n```\n<kod>\n```"
- "Bu metni Gemini'ye yazdır" → app=gemini, prompt="<metnin tamamı>"
- "Kimi'ye 10000 karakterlik özetle" → app=kimi, prompt="Şu metni 10000 karaktere özetle:\n<metin>"
