"""Visual context memory — recent snapshots + pronoun resolution."""
from __future__ import annotations

import re
import time
from collections import deque
from dataclasses import dataclass
from typing import Iterable

from .analyzer import AnalysisResult


MAX_SNAPSHOTS = 5
PRONOUNS_TR = ("şu", "bu", "şunu", "bunu", "onu", "şuna", "buna", "ona")
PRONOUNS_EN = ("it", "that", "this", "the thing")
TRIGGERS = (
    "bak", "ne görüyorsun", "şuna bak", "masamı tara", "ne görüyorsunuz",
    "look at this", "take a look", "what do you see", "scan my desk", "what's in front of you",
)


@dataclass
class Snapshot:
    ts: float
    analysis: AnalysisResult


class VisualMemory:
    def __init__(self, max_age_s: float = 300.0) -> None:
        self._snapshots: deque[Snapshot] = deque(maxlen=MAX_SNAPSHOTS)
        self._max_age_s = max_age_s

    def update(self, analysis: AnalysisResult) -> None:
        self._snapshots.append(Snapshot(ts=time.time(), analysis=analysis))

    def latest(self) -> Snapshot | None:
        if not self._snapshots:
            return None
        snap = self._snapshots[-1]
        if time.time() - snap.ts > self._max_age_s:
            return None
        return snap

    def context_string(self) -> str:
        snap = self.latest()
        if snap is None:
            return ""
        age_s = int(time.time() - snap.ts)
        age_phrase = "az önce" if age_s < 30 else f"{age_s // 60} dakika önce"
        a = snap.analysis
        parts = [f"[Görsel bağlam — {age_phrase}]", a.scene_description]
        if a.spatial_map:
            spatial = ", ".join(f"{k}: {v}" for k, v in a.spatial_map.items() if v)
            parts.append(f"Konumlar: {spatial}")
        if a.text_visible:
            parts.append("Görünen yazılar: " + "; ".join(a.text_visible))
        return "\n".join(parts)

    def clear(self) -> None:
        self._snapshots.clear()


def needs_vision(query: str, *, has_recent_context: bool) -> bool:
    """Return True if query references visual content or contains a trigger phrase."""
    low = query.lower()
    for trig in TRIGGERS:
        if trig in low:
            return True
    if has_recent_context:
        words = re.findall(r"\b\w+\b", low)
        for p in PRONOUNS_TR + PRONOUNS_EN:
            if p in words:
                return True
    return False


def resolve_pronoun(query: str, memory: VisualMemory) -> tuple[str, bool]:
    """If the query contains pronouns AND we have recent visual context, prepend it.

    Returns (final_query, prepended_bool).
    """
    ctx = memory.context_string()
    if not ctx:
        return query, False
    if needs_vision(query, has_recent_context=True):
        return f"{ctx}\n\nKullanıcı sorusu: {query}", True
    return query, False


def format_for_llm(snapshots: Iterable[Snapshot]) -> str:
    """Render multiple snapshots for richer context."""
    lines: list[str] = []
    for snap in snapshots:
        age = int(time.time() - snap.ts)
        lines.append(f"[t-{age}s] {snap.analysis.scene_description}")
    return "\n".join(lines)
