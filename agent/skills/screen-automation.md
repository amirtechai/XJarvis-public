---
name: screen-automation
description: Ekrana bakarak fare/klavye otomasyonu (vision + screen_click)
---

# Screen Automation

Kullanıcı "şu butona tıkla", "X'i bul ve aç", "şu formu doldur" derse:

## Akış

1. **Boyutu öğren** — `screen_size` ile ekran genişlik/yüksekliği
2. **Ekran görüntüsü al** — `screenshot_take` ile (sessiz, /tmp'ye kaydeder)
3. **Görseli analiz et** — `vision_analyze` ile sorduğun konum tarif edilsin
   - Örnek query: "Resimde 'Kaydet' butonu var mı? Varsa yaklaşık piksel konumunu yaz."
4. **Tıkla** — `screen_click(x, y)` ile dön

## İpuçları

- Vision'dan gelen koordinatlar genelde göreceli (0-1 aralığı). Mutlak hale çevir:
  `x = round(rel_x * screen_width)`, `y = round(rel_y * screen_height)`
- Tıklamadan önce `frontmost_app` ile doğru uygulamada olduğunu doğrula
- Yanlış tıklamadan kaçın: emin değilsen kullanıcıya "şuraya tıklayayım mı?" diye sor
- Form doldurma: `screen_click` (input'a) → `screen_type` (metin) → `screen_key('tab')` (sonraki alana)

## Tehlikeli aksiyonlar

Şu durumlarda **önce kullanıcıdan onay al**:
- "Sil" / "Kaldır" / "Send" / "Gönder" butonlarına tıklamadan önce
- 5'ten fazla ardışık tıklama gerekiyorsa
- Sistem ayarları, dosya silme, uygulama kapatma

## Modifier örnekleri

- `Cmd+Tab` (uygulama değiştir): `screen_key('tab', 'command')`
- `Cmd+W` (sekmeyi kapat): `screen_key('w', 'command')`
- `Cmd+Shift+T` (kapatılan sekmeyi aç): `screen_key('t', 'command,shift')`
- Spotlight: `screen_key('space', 'command')`
