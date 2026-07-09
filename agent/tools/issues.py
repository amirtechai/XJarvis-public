"""Issue creation — GitHub (gh CLI) + Linear (GraphQL API).

Usage:
- GitHub: needs `gh` CLI installed and authenticated. Repo defaults to the
  one in current cwd, or pass repo='owner/name'.
- Linear: needs LINEAR_API_KEY env var. team_id can be discovered with
  linear_teams() or hardcoded via LINEAR_DEFAULT_TEAM env.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path

import httpx

from .base import ToolSpec, registry

LINEAR_URL = "https://api.linear.app/graphql"
DEFAULT_REPO_ROOT = Path.home() / "Jarvis" / "jarvis-ui"


async def _run(cmd: list[str], cwd: str | None = None, timeout: float = 20.0) -> tuple[int, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return proc.returncode, (out.decode() + err.decode()).strip()
    except asyncio.TimeoutError:
        return 124, "timeout"


async def github_issue_create(
    title: str,
    body: str = "",
    repo: str = "",
    labels: str = "",
    cwd: str = "",
) -> str:
    """Create a GitHub issue via `gh` CLI. labels: comma-separated."""
    if not shutil.which("gh"):
        return "ERROR: gh CLI not installed (brew install gh)"
    if not title.strip():
        return "ERROR: title required"
    cmd = ["gh", "issue", "create", "--title", title]
    if body:
        cmd += ["--body", body]
    if repo:
        cmd += ["--repo", repo]
    if labels:
        cmd += ["--label", labels]
    work_cwd = cwd or (str(DEFAULT_REPO_ROOT) if DEFAULT_REPO_ROOT.exists() else None)
    rc, out = await _run(cmd, cwd=work_cwd)
    if rc != 0:
        return f"ERROR: {out[:300]}"
    # gh prints the URL on success
    return out.strip().splitlines()[-1]


async def github_issue_list(repo: str = "", state: str = "open", limit: int = 10) -> str:
    if not shutil.which("gh"):
        return "ERROR: gh CLI not installed"
    cmd = ["gh", "issue", "list", "--state", state, "--limit", str(min(50, max(1, int(limit))))]
    if repo:
        cmd += ["--repo", repo]
    cmd += ["--json", "number,title,state,url,labels"]
    work_cwd = str(DEFAULT_REPO_ROOT) if not repo and DEFAULT_REPO_ROOT.exists() else None
    rc, out = await _run(cmd, cwd=work_cwd)
    if rc != 0:
        return f"ERROR: {out[:300]}"
    try:
        items = json.loads(out)
    except json.JSONDecodeError:
        return out[:500]
    if not items:
        return "(boş)"
    lines = []
    for it in items:
        labels = ",".join(l.get("name", "") for l in (it.get("labels") or []))
        lines.append(f"#{it['number']} [{it['state']}] {it['title']}{(' · ' + labels) if labels else ''}")
    return "\n".join(lines)


async def _linear_gql(query: str, variables: dict) -> dict:
    api_key = os.getenv("LINEAR_API_KEY", "").strip()
    if not api_key:
        return {"error": "LINEAR_API_KEY missing"}
    headers = {"Authorization": api_key, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15.0) as c:
        try:
            r = await c.post(LINEAR_URL, headers=headers, json={"query": query, "variables": variables})
        except httpx.HTTPError as e:
            return {"error": str(e)}
    if r.status_code != 200:
        return {"error": f"{r.status_code}: {r.text[:200]}"}
    data = r.json()
    if data.get("errors"):
        return {"error": json.dumps(data["errors"])[:300]}
    return data.get("data") or {}


async def linear_teams() -> str:
    data = await _linear_gql("query { teams { nodes { id name key } } }", {})
    if "error" in data:
        return f"ERROR: {data['error']}"
    nodes = data.get("teams", {}).get("nodes") or []
    if not nodes:
        return "(boş)"
    return "\n".join(f"{n['key']} · {n['name']} · id={n['id']}" for n in nodes)


async def linear_issue_create(title: str, description: str = "", team_id: str = "") -> str:
    if not title.strip():
        return "ERROR: title required"
    if not team_id:
        team_id = os.getenv("LINEAR_DEFAULT_TEAM", "").strip()
    if not team_id:
        return "ERROR: team_id required (or set LINEAR_DEFAULT_TEAM env, or call linear_teams)"
    mutation = (
        "mutation IssueCreate($input: IssueCreateInput!) {"
        " issueCreate(input: $input) { success issue { identifier url title } }"
        "}"
    )
    variables = {"input": {"title": title, "description": description, "teamId": team_id}}
    data = await _linear_gql(mutation, variables)
    if "error" in data:
        return f"ERROR: {data['error']}"
    issue = (data.get("issueCreate") or {}).get("issue") or {}
    if not issue:
        return "ERROR: issueCreate returned no issue"
    return f"{issue.get('identifier','?')} · {issue.get('title','')} · {issue.get('url','')}"


for spec in [
    ToolSpec(
        name="github_issue_create",
        description=(
            "GitHub issue oluştur (gh CLI). Repo verilmezse mevcut Jarvis repo'su. "
            "labels virgülle ayrılmış."
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "body": {"type": "string"},
                "repo": {"type": "string", "description": "owner/name; boş ise default"},
                "labels": {"type": "string"},
                "cwd": {"type": "string"},
            },
            "required": ["title"],
        },
        fn=github_issue_create,
    ),
    ToolSpec(
        name="github_issue_list",
        description="GitHub issue'ları listele. state: open|closed|all.",
        parameters={
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "state": {"type": "string", "enum": ["open", "closed", "all"]},
                "limit": {"type": "integer"},
            },
        },
        fn=github_issue_list,
    ),
    ToolSpec(
        name="linear_teams",
        description="Linear takımları listele (id+key+name).",
        parameters={"type": "object", "properties": {}},
        fn=linear_teams,
    ),
    ToolSpec(
        name="linear_issue_create",
        description=(
            "Linear issue oluştur. team_id boş ise LINEAR_DEFAULT_TEAM env kullanılır. "
            "Kullanıcı 'Linear'da bug aç' derse: önce team_id biliniyor mu kontrol et, "
            "yoksa linear_teams çağır ve sor."
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "team_id": {"type": "string"},
            },
            "required": ["title"],
        },
        fn=linear_issue_create,
    ),
]:
    registry.register(spec)
