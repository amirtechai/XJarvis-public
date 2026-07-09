---
name: notion-control
description: Notion'da arama, sayfa okuma, sayfa oluşturma, içerik ekleme
---

# Notion control

Kullanıcı Notion'la ilgili bir şey isterse (sayfa açmak, aramak, içerik eklemek):

## Arama

```bash
curl -s "http://localhost:3001/api/notion/search?q=<sorgu>"
```

→ ilgili page/db'leri döndürür. Cevapta her sonucun `id`, `object` (page|database), `properties` ve son düzenleme zamanı vardır.

## Sayfa içeriği oku

```bash
curl -s http://localhost:3001/api/notion/page/<id>
```

→ `meta` (page metadata) ve `blocks` (children).

## Yeni sayfa oluştur

```bash
curl -s -X POST http://localhost:3001/api/notion/page \
  -H 'Content-Type: application/json' \
  -d '{"parent_id":"<page-or-database-id>","title":"<başlık>","content":"<her satır bir paragraph>"}'
```

## Sayfaya içerik ekle (append)

```bash
curl -s -X PATCH http://localhost:3001/api/notion/page/<id> \
  -H 'Content-Type: application/json' \
  -d '{"append":"<her satır bir paragraph>"}'
```

## Database query (basit)

```bash
curl -s -X POST http://localhost:3001/api/notion/db/<db-id>/query \
  -H 'Content-Type: application/json' \
  -d '{"filter": { ... }, "sorts": [...]}'
```

## ÖN KOŞUL

Kullanıcının `NOTION_API_KEY` env'ini set etmesi VE ilgili page/db'yi Notion integration'ı ile share etmesi gerekiyor. Hata "Could not find page" gelirse, kullanıcıya integration share'ini hatırlat.

## Kullanım akışı

1. "Geçen hafta toplantı notuna ekleme yap" → önce search ile sayfayı bul, sonra appendBlocks ile ekle.
2. "Yeni bir proje sayfası oluştur" → kullanıcıdan parent (workspace root db veya başka page) ID iste, sonra create.
3. "Notion'daki tasks db'sinden bu haftakileri listele" → db query.
