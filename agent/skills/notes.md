---
name: notes
description: Apple Notes — yeni not, arama, ekleme (AppleScript)
---

# Apple Notes

Kullanıcı "not al", "Notes'a şunu yaz", "şu konuda not bul" derse:

## Yeni not oluştur

```applescript
tell application "Notes"
  activate
  tell account "iCloud"
    make new note at folder "Notes" with properties {name:"BAŞLIK", body:"<p>İÇERİK</p>"}
  end tell
end tell
```

→ `applescript(script="…")` ile çağır. body HTML kabul eder; düz metin için
`<p>` ile sar veya `\n`'leri `<br>` yap.

## Mevcut nota ekle

```applescript
tell application "Notes"
  set targetNote to first note whose name is "BAŞLIK"
  set body of targetNote to (body of targetNote) & "<p>YENİ SATIR</p>"
end tell
```

## Arama

```applescript
tell application "Notes"
  set hits to (every note whose body contains "QUERY")
  set out to ""
  repeat with n in hits
    set out to out & (name of n) & " :: " & (id of n) & "\n"
  end repeat
  return out
end tell
```

## Tipik istekler

- "Bugünkü toplantı notlarını ekle" → bugünün başlıklı notunu bul, append
- "Yeni fikir notu: …" → yeni not, başlık "Fikir — YYYY-MM-DD"
- "X hakkındaki notlarımı ara" → search + sonuçları özetle

## İpuçları

- Notes uygulamasını arka planda da çalışır — `activate` zorunlu değil ama UI'da görmek istiyorsa kullan.
- iCloud account default; kullanıcı "On My Mac" istiyorsa account adını değiştir.
- Multi-line body için `\n` yerine `&return&` kullan (AppleScript newline).
