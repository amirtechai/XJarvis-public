"""WhatsApp send/list — backend bridge wrapper."""
from __future__ import annotations

import httpx

from .base import ToolSpec, registry

BACKEND = "http://127.0.0.1:3001"


async def whatsapp_send(jid: str, text: str) -> str:
    """Send a WhatsApp message. jid format: '90555xxx@s.whatsapp.net' for DM,
    '<group-id>@g.us' for groups. Use whatsapp_recent to discover JIDs."""
    if not jid or not text:
        return "ERROR: jid and text required"
    async with httpx.AsyncClient(timeout=15.0) as c:
        try:
            r = await c.post(f"{BACKEND}/api/whatsapp/send", json={"jid": jid, "text": text})
        except httpx.HTTPError as e:
            return f"ERROR: {e}"
    if r.status_code != 200:
        return f"ERROR {r.status_code}: {r.text[:200]}"
    return "OK"


async def whatsapp_recent() -> str:
    """List the most recent inbound WhatsApp messages (in-memory ring, 50)."""
    async with httpx.AsyncClient(timeout=5.0) as c:
        try:
            r = await c.get(f"{BACKEND}/api/whatsapp/messages")
        except httpx.HTTPError as e:
            return f"ERROR: {e}"
    if r.status_code != 200:
        return f"ERROR {r.status_code}"
    msgs = r.json().get("messages", [])
    if not msgs:
        return "(boş)"
    lines = []
    for m in msgs[-15:]:
        nm = m.get("push_name") or m.get("from", "?")
        lines.append(f"{nm}: {m.get('text','')[:120]}")
    return "\n".join(lines)


async def whatsapp_state() -> str:
    """Connection status, QR pending, deps installed."""
    async with httpx.AsyncClient(timeout=3.0) as c:
        try:
            r = await c.get(f"{BACKEND}/api/whatsapp/state")
        except httpx.HTTPError as e:
            return f"ERROR: {e}"
    s = r.json()
    if not s.get("deps_ok"):
        return "deps missing — kullanıcıya 'cd backend && npm install @whiskeysockets/baileys qrcode pino' demesi gerek"
    return f"connected={s.get('connected')} qr_pending={s.get('qr_pending')} inbox={s.get('inbox_count')}"


for spec in [
    ToolSpec(
        name="whatsapp_send",
        description=(
            "WhatsApp mesajı gönder. jid: kişi için '<countrycode><number>@s.whatsapp.net' "
            "(örn '905551234567@s.whatsapp.net'), grup için '<id>@g.us'. "
            "Hangi JID'e gideceğini bilmiyorsan önce whatsapp_recent ile son mesajlardan bul."
        ),
        parameters={
            "type": "object",
            "properties": {
                "jid": {"type": "string"},
                "text": {"type": "string"},
            },
            "required": ["jid", "text"],
        },
        fn=whatsapp_send,
    ),
    ToolSpec(
        name="whatsapp_recent",
        description="Son 15 gelen WhatsApp mesajını özetle (kim, ne yazdı).",
        parameters={"type": "object", "properties": {}},
        fn=whatsapp_recent,
    ),
    ToolSpec(
        name="whatsapp_state",
        description="WhatsApp köprüsünün durumu (bağlı mı, QR gerekiyor mu, deps var mı).",
        parameters={"type": "object", "properties": {}},
        fn=whatsapp_state,
    ),
]:
    registry.register(spec)
