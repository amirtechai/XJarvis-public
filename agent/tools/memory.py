"""Memory tools — recall past episodes, store/recall persistent facts."""

from __future__ import annotations

import time

from ..memory.store import (
    all_facts,
    fact_get,
    fact_set,
    recent_episodes,
    search_episodes,
)
from .base import ToolSpec, registry


async def memory_recall(query: str, limit: int = 5) -> str:
    eps = search_episodes(query, limit=limit)
    if not eps:
        return "Bu konuyla ilgili geçmiş kayıt yok."
    parts = []
    for e in eps:
        when = time.strftime("%Y-%m-%d %H:%M", time.localtime(e["ts"]))
        parts.append(
            f"[{when}] Q: {e['query'][:100]}\n          A: {(e['response'] or '')[:200]}"
        )
    return "\n\n".join(parts)


async def memory_recent(limit: int = 5) -> str:
    eps = recent_episodes(limit=limit)
    if not eps:
        return "Henüz kayıtlı etkileşim yok."
    return "\n".join(
        f"[{time.strftime('%H:%M', time.localtime(e['ts']))}] {e['query'][:80]}"
        for e in eps
    )


async def daily_digest(hours: int = 24) -> str:
    """Son N saatte KONUŞULANLARIN özeti (episode hafızasından, canlı tool YOK)."""
    eps = recent_episodes(limit=60)
    if not eps:
        return "Bugün henüz kayıtlı bir etkileşim yok Patron."
    cutoff = time.time() - max(1, min(hours, 168)) * 3600
    today = [e for e in eps if e.get("ts", 0) >= cutoff]
    if not today:
        return f"Son {hours} saatte kayıtlı etkileşim yok Patron."
    lines = []
    for e in reversed(today):  # eskiden yeniye
        when = time.strftime("%H:%M", time.localtime(e["ts"]))
        q = (e.get("query") or "").strip()[:100]
        a = (e.get("response") or "").strip()[:140]
        if q:
            lines.append(f"[{when}] Sen: {q}" + (f" · Ben: {a}" if a else ""))
    body = "\n".join(lines)
    return (
        f"Bugün ({len(today)} etkileşim) konuştuklarımız:\n{body}\n\n"
        "Bunları kısa, akıcı bir Türkçe günün-özeti paragrafına çevir; "
        "takvim/mail/başka tool ÇAĞIRMA, sadece bu özeti sun."
    )


async def fact_remember(key: str, value: str) -> str:
    fact_set(key, value)
    return f"OK: {key} = {value}"


async def fact_recall(key: str) -> str:
    v = fact_get(key)
    return v if v is not None else f"({key} hatırlamıyorum)"


async def fact_list() -> str:
    facts = all_facts()
    if not facts:
        return "(no stored facts)"
    return "\n".join(f"{k}: {v}" for k, v in facts.items())


for spec in [
    ToolSpec(
        name="memory_recall",
        description="Geçmiş etkileşimlerde belirli bir konuyu ara (substring).",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": ["query"],
        },
        fn=memory_recall,
    ),
    ToolSpec(
        name="memory_recent",
        description="Son N etkileşimi listele.",
        parameters={
            "type": "object",
            "properties": {"limit": {"type": "integer"}},
        },
        fn=memory_recent,
    ),
    ToolSpec(
        name="daily_digest",
        description=(
            "Bugün / son N saatte KONUŞULANLARIN özeti (hafızadan). 'günün özeti', "
            "'bugün ne yaptık', 'neler konuştuk' istenirse SADECE BUNU çağır — "
            "takvim/mail/whoop gibi canlı tool'ları tek tek çağırıp yavaşlama."
        ),
        parameters={
            "type": "object",
            "properties": {"hours": {"type": "integer"}},
        },
        fn=daily_digest,
    ),
    ToolSpec(
        name="fact_remember",
        description=(
            "Kalıcı bir gerçek/tercih kaydet. Örnek: kullanıcı 'ben Balıkesir'deyim, "
            "hep buranın havasını söyle' derse: fact_remember('user_city', 'Balıkesir')."
        ),
        parameters={
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "value": {"type": "string"},
            },
            "required": ["key", "value"],
        },
        fn=fact_remember,
    ),
    ToolSpec(
        name="fact_recall",
        description="Kayıtlı bir gerçeği oku.",
        parameters={
            "type": "object",
            "properties": {"key": {"type": "string"}},
            "required": ["key"],
        },
        fn=fact_recall,
    ),
    ToolSpec(
        name="fact_list",
        description="Tüm kayıtlı gerçekleri listele.",
        parameters={"type": "object", "properties": {}},
        fn=fact_list,
    ),
]:
    registry.register(spec)
