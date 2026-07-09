"""Spotify Web API tool'ları — search + now-playing + play (Premium)."""
from __future__ import annotations

import os
import httpx

from .base import ToolSpec, registry

BACKEND = os.getenv("BACKEND_URL", "http://127.0.0.1:3001")


async def spotify_now_playing() -> str:
    async with httpx.AsyncClient(timeout=10.0) as c:
        r = await c.get(f"{BACKEND}/api/spotify/now-playing")
    try: d = r.json()
    except Exception: return f"ERR: {r.status_code}"
    if not d.get("ok"):     return f"ERR: {d.get('error')}"
    if not d.get("playing"):return "Şu an çalan yok."
    return f"♫ {d.get('title','')} — {d.get('artist','')}\nAlbüm: {d.get('album','')}"


async def spotify_search(query: str, limit: int = 5) -> str:
    async with httpx.AsyncClient(timeout=10.0) as c:
        r = await c.get(f"{BACKEND}/api/spotify/search", params={"q": query, "limit": limit})
    try: d = r.json()
    except Exception: return f"ERR: {r.status_code}"
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    items = d.get("tracks") or []
    if not items: return "Sonuç yok."
    return "\n".join(f"• {t['name']} — {t['artist']}\n  {t['uri']}" for t in items[:limit])


async def spotify_play(query: str = "", uri: str = "") -> str:
    """Verilen sorgu/URI ile parça çal. Spotify Premium + aktif cihaz gerekli."""
    body = {}
    if uri:   body["uri"] = uri
    if query: body["query"] = query
    async with httpx.AsyncClient(timeout=10.0) as c:
        r = await c.post(f"{BACKEND}/api/spotify/play", json=body)
    try: d = r.json()
    except Exception: return f"ERR: {r.status_code}"
    if d.get("ok"): return f"♫ Çalıyor."
    return f"ERR: {d.get('error', d.get('body'))}"


registry.register(ToolSpec(
    name="spotify_now_playing", description="Spotify'da şu an çalan parçayı getir.",
    parameters={"type": "object", "properties": {}}, fn=spotify_now_playing,
))
registry.register(ToolSpec(
    name="spotify_search", description="Spotify'da parça ara (ücretsiz hesap için de çalışır).",
    parameters={"type": "object", "properties": {
        "query": {"type": "string"}, "limit": {"type": "integer"},
    }, "required": ["query"]},
    fn=spotify_search,
))
registry.register(ToolSpec(
    name="spotify_play", description="Spotify'da parça çal — sorgu veya track URI ile (Premium gerek).",
    parameters={"type": "object", "properties": {
        "query": {"type": "string"}, "uri": {"type": "string"},
    }},
    fn=spotify_play,
))
