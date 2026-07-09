"""Atlassian Jira tool'ları — issue search, create, get, comment."""
from __future__ import annotations

import os
import httpx

from .base import ToolSpec, registry

BACKEND = os.getenv("BACKEND_URL", "http://127.0.0.1:3001")


async def jira_projects() -> str:
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.get(f"{BACKEND}/api/atlassian/projects")
    try: d = r.json()
    except Exception: return f"ERR: {r.status_code}"
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    items = d.get("items") or []
    if not items: return "Proje yok."
    return "\n".join(f"• {p['key']} — {p['name']}" for p in items)


async def jira_search(jql: str = "", max: int = 15) -> str:
    """JQL ile issue ara. Boş bırakırsan: 'bana atanmış, Done olmayan, son güncelleme'."""
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.get(f"{BACKEND}/api/atlassian/issues/search", params={"jql": jql, "max": max})
    try: d = r.json()
    except Exception: return f"ERR: {r.status_code}"
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    items = d.get("items") or []
    if not items: return "Eşleşen issue yok."
    return "\n".join(
        f"• [{i['key']}] {i['summary']}\n  {i.get('status','')} · {i.get('priority','-')} · {i.get('assignee','-')}"
        for i in items
    )


async def jira_issue(key: str) -> str:
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.get(f"{BACKEND}/api/atlassian/issue/{key}")
    try: d = r.json()
    except Exception: return f"ERR: {r.status_code}"
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    return (
        f"[{d['key']}] {d.get('summary','')}\n"
        f"Status: {d.get('status','')} · Priority: {d.get('priority','')}\n"
        f"Assignee: {d.get('assignee','')} · Reporter: {d.get('reporter','')}\n"
        f"Created: {d.get('created','')} · Updated: {d.get('updated','')}\n\n"
        f"{(d.get('description') or '').strip()[:3000]}"
    )


async def jira_create(project: str, summary: str, description: str = "", issueType: str = "Task") -> str:
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(f"{BACKEND}/api/atlassian/issue/create", json={
            "project": project, "summary": summary, "description": description, "issueType": issueType,
        })
    try: d = r.json()
    except Exception: return f"ERR: {r.status_code}"
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    return f"✓ {d.get('key')} oluşturuldu → {d.get('link','')}"


async def jira_comment(key: str, body: str) -> str:
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(f"{BACKEND}/api/atlassian/issue/{key}/comment", json={"body": body})
    try: d = r.json()
    except Exception: return f"ERR: {r.status_code}"
    if not d.get("ok"): return f"ERR: {d.get('error')}"
    return f"✓ Yorum eklendi"


registry.register(ToolSpec(
    name="jira_projects", description="Jira proje listesi (key + ad).",
    parameters={"type": "object", "properties": {}}, fn=jira_projects,
))
registry.register(ToolSpec(
    name="jira_search", description="Jira'da JQL ile issue ara. Boş bırakırsan bana atanmış aktif işler.",
    parameters={"type": "object", "properties": {
        "jql": {"type": "string"}, "max": {"type": "integer"},
    }},
    fn=jira_search,
))
registry.register(ToolSpec(
    name="jira_issue", description="Jira issue detayı (key ile, örn: 'PROJ-123').",
    parameters={"type": "object", "properties": {"key": {"type": "string"}}, "required": ["key"]},
    fn=jira_issue,
))
registry.register(ToolSpec(
    name="jira_create", description="Jira'da yeni issue oluştur.",
    parameters={"type": "object", "properties": {
        "project": {"type": "string", "description": "proje key (örn: PROJ)"},
        "summary": {"type": "string"},
        "description": {"type": "string"},
        "issueType": {"type": "string", "description": "Task/Bug/Story (varsayılan Task)"},
    }, "required": ["project", "summary"]},
    fn=jira_create,
))
registry.register(ToolSpec(
    name="jira_comment", description="Bir Jira issue'ya yorum ekle.",
    parameters={"type": "object", "properties": {
        "key": {"type": "string"}, "body": {"type": "string"},
    }, "required": ["key", "body"]},
    fn=jira_comment,
))
