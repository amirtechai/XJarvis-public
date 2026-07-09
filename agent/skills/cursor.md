---
name: cursor
description: Cursor IDE — dosya/proje aç, terminal komutu, AI prompt
---

# Cursor

Kullanıcı "Cursor'da şu projeyi aç", "şu dosyaya bak", "Cursor'a şunu sor" derse:

## Proje / dosya aç

- Proje aç: `shell_exec("cursor ~/XJarvis")`
- Belirli dosya: `shell_exec("cursor /path/to/file.py")`
- Belirli satır: `shell_exec("cursor --goto /path/to/file.py:42:5")`

`cursor` CLI varsa (Cursor → Command Palette → "Install 'cursor' command"). Yoksa:
`open_app("Cursor")` + sonra `computer_use` ile File → Open.

## Komut paleti

`Cmd+Shift+P` → `screen_key("p", "command,shift")`

## AI chat / Composer

- Chat aç: `Cmd+L` → `screen_key("l", "command")`
- Composer (Cmd+I): `screen_key("i", "command")`
- Sonra `clipboard_write(prompt)` + `Cmd+V` + `return`.

## Terminal

- Aç/kapa: `Ctrl+\``  → `screen_key("`", "control")`
- Komut çalıştır: terminale focus + `clipboard_write(cmd)` + paste + return.

Daha temiz alternatif: agent'ın kendi `shell_exec` tool'unu kullan
(Cursor terminali yerine doğrudan).

## Tipik istekler

- "Cursor'da bu dosyayı aç" → `shell_exec(f"cursor {path}")`
- "Cursor'a bu hatayı sor" → cursor aç, Cmd+L, prompt paste
- "Şu dosyada error sayısı" → `shell_exec` ile cursor değil, doğrudan
  `grep -c ERROR …` daha hızlı

## İpuçları

- Cursor zaten açıksa `cursor PATH` yeni pencere/sekme açar (ayara göre).
- AI prompt için doğrudan `agent` (ben) cevap verebilir — Cursor'a forward
  etmek genelde gereksiz, kullanıcıya sor: "Bunu ben mi yanıtlayayım?"
- `Cmd+P` (Quick file) — fuzzy file search dosya açmanın en hızlı yolu.
