"""XJarvis-internal page navigation.

The Tauri webview hosts the local Next.js app on http://localhost:3000.
Slug catalogue is kept aligned with `components/dashboard/DashboardHamburger.tsx`
so every hamburger item is voice-addressable.
"""
from __future__ import annotations

import asyncio
import json
import urllib.request

from .base import ToolSpec, registry

# Slug catalogue — MUST stay aligned with DashboardHamburger LINKS array.
# Aliases include the hamburger label, Turkish synonyms, and natural speech.
PAGES: dict[str, dict] = {
    "dashboard":     {"route": "/dashboard",     "label": "Orbital HUD",  "aliases": ["dashboard", "orbital hud", "orbital", "ana ekran", "ana sayfa", "hud"]},
    "chat":          {"route": "/",              "label": "Chat",         "aliases": ["chat", "sohbet", "ana sohbet"]},
    "news":          {"route": "/news",          "label": "News",         "aliases": ["news", "haberler", "haber"]},
    "world":         {"route": "/world",         "label": "World Watch",  "aliases": ["world", "world watch", "dünya", "dünya izle"]},
    "cyber":         {"route": "/cyber",         "label": "Cyber",        "aliases": ["cyber", "siber", "güvenlik"]},
    "creative":      {"route": "/creative",      "label": "Creative",     "aliases": ["creative", "yaratıcı", "creative studio"]},
    "dev":           {"route": "/dev",           "label": "Dev",          "aliases": ["dev", "geliştirici", "developer"]},
    "trading":       {"route": "/trading",       "label": "Trading",      "aliases": ["trading", "borsa", "kripto", "alım satım"]},
    "history":       {"route": "/history",       "label": "History",      "aliases": ["history", "geçmiş", "konuşma geçmişi"]},
    "dictation":     {"route": "/dictation",     "label": "Dictation",    "aliases": ["dictation", "dikte"]},
    # Multi-TV → /youtube (her hamburger satırına göre canlı katalog)
    "multi-tv":      {"route": "/youtube",       "label": "Multi-TV",     "aliases": ["multi tv", "multi-tv", "çoklu tv", "tv duvarı", "youtube", "yt", "video duvar"]},
    "notion":        {"route": "/notion",        "label": "Notion",       "aliases": ["notion"]},
    "design":        {"route": "/design",        "label": "Design",       "aliases": ["design", "tasarım", "design studio"]},
    "research":      {"route": "/research",      "label": "Research",     "aliases": ["research", "araştırma"]},
    "agents":        {"route": "/agents",        "label": "Agents",       "aliases": ["agents", "ajanlar", "alt ajanlar"]},
    "tools":         {"route": "/tools",         "label": "Tools",        "aliases": ["tools", "araçlar"]},
    "briefing":      {"route": "/briefing",      "label": "Brief",        "aliases": ["briefing", "brief", "brifing", "günlük özet", "günün özeti"]},
    "knowledge":     {"route": "/knowledge",     "label": "KGraph",       "aliases": ["knowledge", "kgraph", "bilgi", "bilgi grafiği", "knowledge graph"]},
    "companion":     {"route": "/companion",     "label": "Remote",       "aliases": ["companion", "remote", "uzak", "uzak yardımcı"]},
    "costs":         {"route": "/costs",         "label": "Cost",         "aliases": ["cost", "costs", "maliyet", "harcama", "fiyatlar"]},
    "replay":        {"route": "/replay",        "label": "Replay",       "aliases": ["replay", "yeniden oynat", "tekrar oynat"]},
    "crashes":       {"route": "/crashes",       "label": "Crashes",      "aliases": ["crashes", "çökme", "çökmeler", "hatalar"]},
    "inbox":         {"route": "/inbox",         "label": "Inbox",        "aliases": ["inbox", "gelen kutusu", "mailler", "e-postalar"]},
    "calendar":      {"route": "/calendar-pro",  "label": "Calendar+",    "aliases": ["calendar", "calendar plus", "calendar pro", "takvim", "ajanda"]},
    "podcast":       {"route": "/podcast",       "label": "Podcast",      "aliases": ["podcast", "podcastler", "podcast stüdyosu"]},
    "whiteboard":    {"route": "/whiteboard",    "label": "Whiteboard",   "aliases": ["whiteboard", "beyaz tahta", "tahta"]},
    "connectors":    {"route": "/connectors",    "label": "Connectors",   "aliases": ["connectors", "bağlantılar", "entegrasyonlar"]},
    "goals":         {"route": "/goals",         "label": "Goals",        "aliases": ["goals", "hedefler", "hedeflerim"]},
    "drafts":        {"route": "/drafts",        "label": "Drafts",       "aliases": ["drafts", "taslaklar", "mail taslakları"]},
    "workflows":     {"route": "/workflows",     "label": "Workflows",    "aliases": ["workflows", "iş akışları", "otomasyonlar"]},
    "logs":          {"route": "/logs",          "label": "Logs",         "aliases": ["logs", "loglar", "kayıtlar"]},
    "health":        {"route": "/health",        "label": "Health",       "aliases": ["health", "sağlık", "whoop", "uyku"]},
    "preferences":   {"route": "/preferences",   "label": "Settings",     "aliases": ["preferences", "settings", "ayarlar", "tercihler"]},
    # Hamburger'de olmayan ama mevcut sayfalar
    "quick-capture": {"route": "/quick-capture", "label": "Quick Capture","aliases": ["quick capture", "hızlı kayıt", "not al"]},
    "mobile":        {"route": "/mobile",        "label": "Mobile",       "aliases": ["mobile", "mobil"]},
}

# Flat alias → key map for fast lookup.
_ALIAS_INDEX: dict[str, str] = {}
for key, meta in PAGES.items():
    _ALIAS_INDEX[key.lower()] = key
    _ALIAS_INDEX[meta["label"].lower()] = key
    for alias in meta["aliases"]:
        _ALIAS_INDEX[alias.lower()] = key


def _resolve(query: str) -> str | None:
    q = (query or "").strip().lower().lstrip("/")
    if not q:
        return None
    if q in _ALIAS_INDEX:
        return _ALIAS_INDEX[q]
    matches = [(alias, key) for alias, key in _ALIAS_INDEX.items() if alias in q]
    if matches:
        matches.sort(key=lambda x: len(x[0]), reverse=True)
        return matches[0][1]
    return None


def _navigate_via_bus_sync(route: str) -> bool:
    """Synchronous HTTP call to navigate via bus."""
    try:
        payload = json.dumps({"route": route}).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:3001/api/nav/goto",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            return resp.status == 200
    except Exception:
        return False


async def _navigate_via_bus(route: str) -> bool:
    """Tell the backend to broadcast a NAVIGATE bus event so the active Tauri
    webview can router.push() to the route without spawning a Safari tab."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _navigate_via_bus_sync, route)


async def xjarvis_page(name: str) -> str:
    """Open an XJarvis internal page (NEWS, MULTI-TV, GOALS, CALENDAR, …).

    Accepts canonical slug ("news"), hamburger label ("Multi-TV"), or natural
    Turkish phrasing ("haberleri", "takvimi", "çoklu tv").
    """
    key = _resolve(name)
    if not key:
        avail = ", ".join(f"{k} ({PAGES[k]['label']})" for k in sorted(PAGES.keys()))
        return f"ERROR: '{name}' bilinen bir XJarvis sayfası değil. Mevcut: {avail}"
    route = PAGES[key]["route"]
    label = PAGES[key]["label"]

    if await _navigate_via_bus(route):
        return f"Açıldı → {label} ({route})"

    # Fallback: open the route in a browser via macOS `open`.
    url = "http://localhost:3000" + route
    proc = await asyncio.create_subprocess_exec(
        "open", url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        return f"ERROR: {stderr.decode().strip()}"
    return f"Açıldı (Safari) → {label} ({url})"


async def xjarvis_page_list() -> str:
    """List every XJarvis internal page available to xjarvis_page()."""
    lines = [f"{meta['label']} → {meta['route']}" for meta in sorted(PAGES.values(), key=lambda v: v['label'])]
    return "\n".join(lines)


registry.register(ToolSpec(
    name="xjarvis_page",
    description=(
        "XJarvis'in KENDİ sayfalarını aç (NEWS, MULTI-TV, ORBITAL HUD, GOALS, "
        "CALENDAR+, INBOX, TRADING, HEALTH, NOTION, RESEARCH, DESIGN, AGENTS, "
        "TOOLS, BRIEF, KGRAPH, REMOTE, COST, REPLAY, CRASHES, PODCAST, "
        "WHITEBOARD, CONNECTORS, DRAFTS, WORKFLOWS, LOGS, SETTINGS, CYBER, "
        "DEV, CREATIVE, DICTATION, HISTORY, CHAT, WORLD WATCH). Kullanıcı "
        "'haberleri aç', 'multi tv aç', 'takvim', 'hedeflerim', 'inbox' gibi "
        "şeyler söylerse BU tool'u kullan — open_app DEĞİL. open_app sadece "
        "macOS uygulamaları içindir (Safari, Hesap Makinesi, Spotify vb.)."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": (
                    "Sayfa adı veya doğal ifade. Örnek: 'news', 'haberler', "
                    "'multi tv', 'çoklu tv', 'orbital hud', 'dashboard', "
                    "'takvim', 'inbox', 'goals', 'trading', 'kgraph', 'brief'."
                ),
            }
        },
        "required": ["name"],
    },
    fn=xjarvis_page,
))

registry.register(ToolSpec(
    name="xjarvis_page_list",
    description=(
        "XJarvis içinde açılabilen tüm sayfaların (hamburger menüdekiler "
        "dahil) listesini döndür. Kullanıcı 'neler yapabilirsin', 'menüde ne "
        "var', 'hangi sayfalar var' dediğinde bunu çağır."
    ),
    parameters={"type": "object", "properties": {}},
    fn=xjarvis_page_list,
))
