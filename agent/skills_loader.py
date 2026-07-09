"""Skill loader — markdown-based recipes that XJarvis can invoke by name.

Skill format (frontmatter optional):
---
name: spotify-control
description: Spotify uygulamasını kontrol et (çal, durdur, sıradaki, ses)
---

# Spotify Control

Bu skill kullanıldığında: ...

Komutlar:
- "çal" → applescript('tell application "Spotify" to play')
- "durdur" → applescript('tell application "Spotify" to pause')
"""
from __future__ import annotations

import re
from pathlib import Path

from .tools.base import ToolSpec, registry

SKILLS_DIR = Path(__file__).resolve().parent / "skills"


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Return (meta, body). Frontmatter is optional."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    fm = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")
    meta: dict = {}
    for line in fm.splitlines():
        m = re.match(r"^([\w-]+):\s*(.*)$", line.strip())
        if m:
            meta[m.group(1)] = m.group(2).strip()
    return meta, body


class Skill:
    def __init__(self, name: str, description: str, content: str, path: Path) -> None:
        self.name = name
        self.description = description
        self.content = content
        self.path = path


class SkillRegistry:
    def __init__(self) -> None:
        self.skills: dict[str, Skill] = {}

    def load_all(self, root: Path = SKILLS_DIR) -> None:
        if not root.exists():
            return
        for md in root.glob("*.md"):
            try:
                text = md.read_text(encoding="utf-8")
            except Exception:
                continue
            meta, body = _parse_frontmatter(text)
            name = meta.get("name") or md.stem
            description = meta.get("description") or f"Skill: {name}"
            self.skills[name] = Skill(name, description, body, md)

    def list_summary(self) -> str:
        if not self.skills:
            return "(no skills)"
        return "\n".join(f"• {s.name}: {s.description}" for s in self.skills.values())

    def get_content(self, name: str) -> str | None:
        s = self.skills.get(name)
        return s.content if s else None


skills_registry = SkillRegistry()


def register_skill_tools() -> None:
    """Register two meta-tools so the LLM can discover and invoke skills."""
    skills_registry.load_all()

    async def list_skills() -> str:
        return skills_registry.list_summary()

    async def invoke_skill(name: str) -> str:
        content = skills_registry.get_content(name)
        if not content:
            return f"ERROR: skill '{name}' not found. Use list_skills first."
        return f"[SKILL: {name}]\n\n{content}"

    registry.register(ToolSpec(
        name="list_skills",
        description="Mevcut skill'leri listele (her biri için isim + kısa açıklama).",
        parameters={"type": "object", "properties": {}},
        fn=list_skills,
    ))
    registry.register(ToolSpec(
        name="invoke_skill",
        description=(
            "Bir skill'in içeriğini yükle ve uygula. Skill markdown formatında "
            "yönergeler içerir. Önce list_skills ile mevcutları gör."
        ),
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Skill adı"},
            },
            "required": ["name"],
        },
        fn=invoke_skill,
    ))
