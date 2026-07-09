"""Google Workspace tool-belt — Gmail / Calendar / Tasks / Drive / People.

Tüm tool'lar backend'in /api/google/* endpoint'lerine HTTP çağrısı yapar.
Backend OAuth refresh + token yönetimini hallediyor; biz sadece sonucu alırız.
"""
from __future__ import annotations

import os
import httpx

from .base import ToolSpec, registry

BACKEND = os.getenv("BACKEND_URL", "http://127.0.0.1:3001")


async def _get(path: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=20.0) as c:
        r = await c.get(f"{BACKEND}{path}", params=params or {})
    try: return r.json()
    except Exception: return {"ok": False, "error": f"HTTP {r.status_code}"}


async def _post(path: str, body: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=20.0) as c:
        r = await c.post(f"{BACKEND}{path}", json=body or {})
    try: return r.json()
    except Exception: return {"ok": False, "error": f"HTTP {r.status_code}"}


# ─────────────────── GMAIL

async def gmail_list(q: str = "is:unread", max: int = 10) -> str:
    d = await _get("/api/google/gmail/list", {"q": q, "max": max})
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    items = d.get("items") or []
    if not items: return "Gelen kutusu temiz."
    out = []
    for it in items:
        flag = "●" if it.get("unread") else "○"
        out.append(f"{flag} {it.get('subject','(no subject)')[:80]}\n   {it.get('from','')[:60]} · {it.get('date','')[:25]}\n   id: {it['id']}")
    return "\n\n".join(out)


async def gmail_read(id: str) -> str:
    d = await _get("/api/google/gmail/get", {"id": id})
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    return f"From: {d.get('from','')}\nTo: {d.get('to','')}\nSubject: {d.get('subject','')}\nDate: {d.get('date','')}\n\n{d.get('body','')[:6000]}"


async def gmail_send(to: str, subject: str, body: str) -> str:
    d = await _post("/api/google/gmail/send", {"to": to, "subject": subject, "body": body})
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    return f"✓ Gönderildi (id: {d.get('id')})"


async def gmail_draft(to: str, subject: str, body: str) -> str:
    d = await _post("/api/google/gmail/draft", {"to": to, "subject": subject, "body": body})
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    return f"✓ Taslak oluşturuldu (id: {d.get('draft_id')})"


# ─────────────────── CALENDAR

async def gcal_upcoming(max: int = 10) -> str:
    d = await _get("/api/google/calendar/upcoming", {"max": max})
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    items = d.get("items") or []
    if not items: return "Yaklaşan etkinlik yok."
    out = []
    for e in items:
        out.append(f"• {e.get('summary','(no title)')}\n  {e.get('start','')} → {e.get('end','')}\n  {e.get('location') or ''}".rstrip())
    return "\n".join(out)


async def gcal_create(summary: str, start: str, end: str = "", attendees: str = "", description: str = "") -> str:
    """start/end ISO 8601 (örn: 2026-05-09T15:00:00+03:00). attendees virgülle ayrılmış email."""
    body = {"summary": summary, "start": start, "end": end or start, "description": description}
    if attendees:
        body["attendees"] = [a.strip() for a in attendees.split(",") if a.strip()]
    d = await _post("/api/google/calendar/create", body)
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    return f"✓ Etkinlik oluşturuldu: {d.get('link','')}"


# ─────────────────── TASKS

async def gtasks_list() -> str:
    d = await _get("/api/google/tasks/list")
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    items = d.get("items") or []
    if not items: return "Görev yok."
    return "\n".join(f"• {t.get('title','')}{' (' + (t.get('due') or '') + ')' if t.get('due') else ''}" for t in items)


async def gtasks_add(title: str, notes: str = "", due: str = "") -> str:
    body = {"title": title}
    if notes: body["notes"] = notes
    if due:   body["due"] = due
    d = await _post("/api/google/tasks/add", body)
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    return f"✓ Görev eklendi"


# ─────────────────── DRIVE

async def gdrive_recent(max: int = 10) -> str:
    d = await _get("/api/google/drive/recent", {"max": max})
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    items = d.get("items") or []
    if not items: return "Drive'da yeni dosya yok."
    return "\n".join(f"• {f['name']} · {f.get('mimeType','').split('.')[-1]} · {f.get('modifiedTime','')[:10]}\n  {f.get('webViewLink','')}" for f in items)


# ─────────────────── PEOPLE

async def gpeople_search(query: str) -> str:
    d = await _get("/api/google/people/search", {"q": query})
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    items = d.get("items") or []
    if not items: return "Eşleşen kişi yok."
    return "\n".join(f"• {p['name']} → {p['email']}" for p in items)


# ─────────────────── REGISTER

registry.register(ToolSpec(
    name="gmail_list", description="Gmail mesajlarını listele (q: arama sorgusu, varsayılan is:unread).",
    parameters={"type": "object", "properties": {"q": {"type": "string"}, "max": {"type": "integer"}}},
    fn=gmail_list,
))
registry.register(ToolSpec(
    name="gmail_read", description="Gmail mesaj ID'siyle tek mail oku (subject, from, body).",
    parameters={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
    fn=gmail_read,
))
registry.register(ToolSpec(
    name="gmail_send", description="Gmail mail gönder.",
    parameters={"type": "object", "properties": {
        "to": {"type": "string"}, "subject": {"type": "string"}, "body": {"type": "string"},
    }, "required": ["to", "subject", "body"]},
    fn=gmail_send,
))
registry.register(ToolSpec(
    name="gmail_draft", description="Gmail taslak oluştur (gönderme).",
    parameters={"type": "object", "properties": {
        "to": {"type": "string"}, "subject": {"type": "string"}, "body": {"type": "string"},
    }, "required": ["to", "subject", "body"]},
    fn=gmail_draft,
))
registry.register(ToolSpec(
    name="gcal_upcoming", description="Google Calendar yaklaşan etkinlikler.",
    parameters={"type": "object", "properties": {"max": {"type": "integer"}}},
    fn=gcal_upcoming,
))
registry.register(ToolSpec(
    name="gcal_create", description="Google Calendar etkinlik oluştur. start/end ISO 8601 (timezone dahil).",
    parameters={"type": "object", "properties": {
        "summary": {"type": "string"}, "start": {"type": "string"}, "end": {"type": "string"},
        "attendees": {"type": "string", "description": "virgülle ayrılmış email listesi"},
        "description": {"type": "string"},
    }, "required": ["summary", "start"]},
    fn=gcal_create,
))
registry.register(ToolSpec(
    name="gtasks_list", description="Google Tasks listesi (tamamlanmamış).",
    parameters={"type": "object", "properties": {}},
    fn=gtasks_list,
))
registry.register(ToolSpec(
    name="gtasks_add", description="Google Tasks görev ekle. due: ISO 8601 (opsiyonel).",
    parameters={"type": "object", "properties": {
        "title": {"type": "string"}, "notes": {"type": "string"}, "due": {"type": "string"},
    }, "required": ["title"]},
    fn=gtasks_add,
))
registry.register(ToolSpec(
    name="gdrive_recent", description="Google Drive son güncellenen dosyalar.",
    parameters={"type": "object", "properties": {"max": {"type": "integer"}}},
    fn=gdrive_recent,
))
registry.register(ToolSpec(
    name="gpeople_search", description="Google Contacts'ta isimle email ara (örn: 'Ahmet').",
    parameters={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    fn=gpeople_search,
))
