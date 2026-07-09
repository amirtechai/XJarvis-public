"""Notion + Obsidian append-to-daily-note tools.

Obsidian: pure filesystem. Set OBSIDIAN_VAULT env to your vault root.
  Daily note pattern: <vault>/Daily/YYYY-MM-DD.md (configurable via OBSIDIAN_DAILY_DIR).
  Auto-creates the file with `# YYYY-MM-DD` heading on first append.

Notion: REST API. Set NOTION_API_KEY (integration token) and either
  NOTION_DAILY_PAGE_ID (parent page where new daily children land) or
  NOTION_DAILY_DATABASE_ID (DB with a Date property called 'Date').
"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

import httpx

from .base import ToolSpec, registry

NOTION_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"


# ---------------- Obsidian ----------------

def _vault_path() -> Path | None:
    p = os.getenv("OBSIDIAN_VAULT", "").strip()
    if not p:
        return None
    return Path(p).expanduser()


def _daily_dir(vault: Path) -> Path:
    sub = os.getenv("OBSIDIAN_DAILY_DIR", "Daily").strip() or "Daily"
    return vault / sub


def _today_filename() -> str:
    fmt = os.getenv("OBSIDIAN_DAILY_FORMAT", "%Y-%m-%d")
    return datetime.now().strftime(fmt) + ".md"


async def obsidian_append_daily(text: str, heading: str = "") -> str:
    """Append text to today's Obsidian daily note. heading: optional ## subheading."""
    vault = _vault_path()
    if not vault:
        return "ERROR: OBSIDIAN_VAULT env not set"
    if not vault.exists():
        return f"ERROR: vault path missing: {vault}"
    if not text.strip():
        return "ERROR: empty text"
    daily_dir = _daily_dir(vault)
    daily_dir.mkdir(parents=True, exist_ok=True)
    fname = _today_filename()
    target = daily_dir / fname

    block = ""
    if not target.exists():
        block += f"# {datetime.now().strftime('%Y-%m-%d')}\n\n"
    if heading.strip():
        block += f"## {heading.strip()}\n"
    timestamp = datetime.now().strftime("%H:%M")
    block += f"- [{timestamp}] {text.strip()}\n"

    with target.open("a", encoding="utf-8") as f:
        f.write(block)
    return f"OK: appended to {target}"


async def obsidian_create_note(title: str, content: str, folder: str = "") -> str:
    """Create a new Obsidian note (folder optional, relative to vault)."""
    vault = _vault_path()
    if not vault:
        return "ERROR: OBSIDIAN_VAULT env not set"
    safe_title = "".join(c if c.isalnum() or c in " -_." else "-" for c in title).strip()
    if not safe_title:
        return "ERROR: invalid title"
    parent = vault / folder if folder else vault
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / f"{safe_title}.md"
    if target.exists():
        target = parent / f"{safe_title} {datetime.now().strftime('%H%M%S')}.md"
    body = f"# {title}\n\n{content.strip()}\n"
    target.write_text(body, encoding="utf-8")
    return f"OK: created {target}"


# ---------------- Notion ----------------

def _notion_headers() -> dict | None:
    key = os.getenv("NOTION_API_KEY", "").strip()
    if not key:
        return None
    return {
        "Authorization": f"Bearer {key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def _paragraph(text: str) -> dict:
    return {
        "object": "block",
        "type": "paragraph",
        "paragraph": {"rich_text": [{"type": "text", "text": {"content": text[:1900]}}]},
    }


async def notion_append_daily(text: str, heading: str = "") -> str:
    """Append a paragraph to today's daily entry. Uses NOTION_DAILY_PAGE_ID
    (append children) or NOTION_DAILY_DATABASE_ID (find/create today row)."""
    headers = _notion_headers()
    if not headers:
        return "ERROR: NOTION_API_KEY missing"
    if not text.strip():
        return "ERROR: empty text"
    timestamp = datetime.now().strftime("%H:%M")
    line = f"[{timestamp}] {text.strip()}"

    page_id = os.getenv("NOTION_DAILY_PAGE_ID", "").strip()
    database_id = os.getenv("NOTION_DAILY_DATABASE_ID", "").strip()

    blocks = []
    if heading.strip():
        blocks.append({
            "object": "block", "type": "heading_3",
            "heading_3": {"rich_text": [{"type": "text", "text": {"content": heading.strip()}}]},
        })
    blocks.append(_paragraph(line))

    async with httpx.AsyncClient(timeout=15.0) as c:
        if database_id:
            today = datetime.now().strftime("%Y-%m-%d")
            # Look up row with Date == today
            q = await c.post(
                f"{NOTION_BASE}/databases/{database_id}/query",
                headers=headers,
                json={"filter": {"property": "Date", "date": {"equals": today}}, "page_size": 1},
            )
            if q.status_code != 200:
                return f"ERROR: db query {q.status_code}: {q.text[:200]}"
            results = q.json().get("results") or []
            if results:
                target_id = results[0]["id"]
            else:
                # Create new row
                payload = {
                    "parent": {"database_id": database_id},
                    "properties": {
                        "Name": {"title": [{"type": "text", "text": {"content": today}}]},
                        "Date": {"date": {"start": today}},
                    },
                    "children": blocks,
                }
                cr = await c.post(f"{NOTION_BASE}/pages", headers=headers, json=payload)
                if cr.status_code not in (200, 201):
                    return f"ERROR: page create {cr.status_code}: {cr.text[:200]}"
                return f"OK: created page {today}"
            r = await c.patch(
                f"{NOTION_BASE}/blocks/{target_id}/children",
                headers=headers, json={"children": blocks},
            )
            if r.status_code != 200:
                return f"ERROR: append {r.status_code}: {r.text[:200]}"
            return f"OK: appended to db row {today}"

        if page_id:
            r = await c.patch(
                f"{NOTION_BASE}/blocks/{page_id}/children",
                headers=headers, json={"children": blocks},
            )
            if r.status_code != 200:
                return f"ERROR: append {r.status_code}: {r.text[:200]}"
            return "OK: appended to daily page"

        return "ERROR: NOTION_DAILY_PAGE_ID or NOTION_DAILY_DATABASE_ID required"


async def notion_create_page(title: str, content: str, parent_page_id: str = "") -> str:
    """Create a new Notion page under parent_page_id (or NOTION_DEFAULT_PARENT env)."""
    headers = _notion_headers()
    if not headers:
        return "ERROR: NOTION_API_KEY missing"
    parent = parent_page_id or os.getenv("NOTION_DEFAULT_PARENT", "").strip()
    if not parent:
        return "ERROR: parent_page_id required"
    payload = {
        "parent": {"page_id": parent},
        "properties": {
            "title": {"title": [{"type": "text", "text": {"content": title[:200]}}]},
        },
        "children": [_paragraph(content)] if content.strip() else [],
    }
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(f"{NOTION_BASE}/pages", headers=headers, json=payload)
    if r.status_code not in (200, 201):
        return f"ERROR: {r.status_code}: {r.text[:200]}"
    return f"OK: {r.json().get('url','')}"


for spec in [
    ToolSpec(
        name="obsidian_append_daily",
        description=(
            "Bugünün Obsidian daily note'una satır ekle. OBSIDIAN_VAULT env'i gerekli. "
            "heading verilirse ## subheading altına yazar."
        ),
        parameters={
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "heading": {"type": "string"},
            },
            "required": ["text"],
        },
        fn=obsidian_append_daily,
    ),
    ToolSpec(
        name="obsidian_create_note",
        description="Vault'ta yeni .md notu oluştur. folder vault'a göre relative.",
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string"},
                "folder": {"type": "string"},
            },
            "required": ["title", "content"],
        },
        fn=obsidian_create_note,
    ),
    ToolSpec(
        name="notion_append_daily",
        description=(
            "Notion daily entry'ye paragraf ekle. NOTION_API_KEY + "
            "(NOTION_DAILY_PAGE_ID veya NOTION_DAILY_DATABASE_ID) gerekli. DB modunda "
            "bugün kaydı yoksa otomatik oluşturulur."
        ),
        parameters={
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "heading": {"type": "string"},
            },
            "required": ["text"],
        },
        fn=notion_append_daily,
    ),
    ToolSpec(
        name="notion_create_page",
        description="Notion'da yeni sayfa oluştur. parent_page_id boş ise NOTION_DEFAULT_PARENT.",
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string"},
                "parent_page_id": {"type": "string"},
            },
            "required": ["title", "content"],
        },
        fn=notion_create_page,
    ),
]:
    registry.register(spec)
