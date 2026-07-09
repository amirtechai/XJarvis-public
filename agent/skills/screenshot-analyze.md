---
name: screenshot-analyze
description: Ekran görüntüsü al ve analiz et (vision sidecar varsa)
---

# Screenshot + Analyze

Kullanıcı "ekrana bak", "ne görüyorsun", "şu ekrandakini özetle" dediğinde:

1. `shell_exec("screencapture -x /tmp/xjarvis-screen.png")` — sessizce ekran al
2. `shell_exec("file /tmp/xjarvis-screen.png")` — boyut/format kontrol
3. Vision sidecar (port 8765) çalışıyorsa `web_fetch("http://localhost:8765/capture?path=/tmp/xjarvis-screen.png")` ile analiz iste
4. Sonucu Türkçe özetle, 1-2 cümleyle

Vision sidecar offline ise: dosya yolunu söyle ve "vision sidecar kapalı, manuel açmamı ister misiniz?" de.
