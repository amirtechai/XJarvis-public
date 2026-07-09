"""Standup writer — collect git activity + PRs and produce a daily summary draft."""
from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path

from .base import ToolSpec, registry

DEFAULT_PATHS = [
    str(Path.home() / "Jarvis"),
    str(Path.home() / "Projects"),
    str(Path.home() / "Code"),
]


async def _run(cmd: list[str], cwd: str | None = None, timeout: float = 8.0) -> tuple[int, str]:
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
    except FileNotFoundError as e:
        return 127, str(e)


def _find_repos(roots: list[str], max_depth: int = 3) -> list[Path]:
    seen: set[Path] = set()
    found: list[Path] = []
    for root in roots:
        rp = Path(root).expanduser()
        if not rp.exists():
            continue
        for git_dir in rp.rglob(".git"):
            try:
                rel = git_dir.relative_to(rp)
                if len(rel.parts) - 1 > max_depth:
                    continue
            except ValueError:
                continue
            repo = git_dir.parent
            if repo in seen:
                continue
            seen.add(repo)
            found.append(repo)
            if len(found) >= 25:
                return found
    return found


async def _git_author(repo: Path) -> str:
    rc, out = await _run(["git", "config", "user.email"], cwd=str(repo))
    return out.strip() if rc == 0 else ""


async def _git_log_since(repo: Path, since_hours: int, author: str | None) -> list[str]:
    since = f"{since_hours} hours ago"
    cmd = ["git", "log", f"--since={since}", "--pretty=%h %s", "--no-merges"]
    if author:
        cmd.append(f"--author={author}")
    rc, out = await _run(cmd, cwd=str(repo))
    if rc != 0 or not out:
        return []
    return [ln for ln in out.splitlines() if ln.strip()][:30]


async def _gh_recent_prs(repo: Path, since_hours: int) -> list[str]:
    if not shutil.which("gh"):
        return []
    rc, out = await _run(
        [
            "gh", "pr", "list",
            "--state", "all",
            "--author", "@me",
            "--limit", "10",
            "--json", "number,title,state,updatedAt,url",
        ],
        cwd=str(repo),
        timeout=12.0,
    )
    if rc != 0 or not out:
        return []
    import json
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    try:
        items = json.loads(out)
    except json.JSONDecodeError:
        return []
    lines: list[str] = []
    for it in items:
        try:
            updated = datetime.fromisoformat(it["updatedAt"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        if updated < cutoff:
            continue
        lines.append(f"#{it.get('number','?')} [{it.get('state','?')}] {it.get('title','?')}")
    return lines


async def standup_draft(paths: list[str] | None = None, since_hours: int = 24) -> str:
    """Collect git commits + recent PRs across repos and return a markdown draft.

    paths: explicit list of repo roots; default scans ~/Jarvis, ~/Projects, ~/Code.
    """
    roots = paths if paths else DEFAULT_PATHS
    since_hours = max(1, min(int(since_hours), 24 * 14))

    repos = _find_repos(roots)
    if not repos:
        return f"Repo bulunamadı: {roots}"

    sections: list[str] = []
    summary_repo_count = 0
    total_commits = 0
    total_prs = 0

    for repo in repos:
        author = await _git_author(repo)
        commits = await _git_log_since(repo, since_hours, author or None)
        prs = await _gh_recent_prs(repo, since_hours)
        if not commits and not prs:
            continue
        summary_repo_count += 1
        total_commits += len(commits)
        total_prs += len(prs)

        lines = [f"### {repo.name}"]
        if commits:
            lines.append("**Commits:**")
            lines.extend(f"- {c}" for c in commits)
        if prs:
            lines.append("**PRs:**")
            lines.extend(f"- {p}" for p in prs)
        sections.append("\n".join(lines))

    if not sections:
        return f"Son {since_hours}sa içinde {len(repos)} repo'da hareket yok."

    header = (
        f"# Daily Standup — son {since_hours} saat\n\n"
        f"_{summary_repo_count} repo · {total_commits} commit · {total_prs} PR_\n"
    )
    return header + "\n\n" + "\n\n".join(sections)


registry.register(
    ToolSpec(
        name="standup_draft",
        description=(
            "Günlük standup taslağı üret: belirtilen repo köklerindeki git commit'leri + "
            "son güncellenen kendi PR'larını topla, markdown özet döndür. "
            "paths verilmezse ~/Jarvis, ~/Projects, ~/Code taranır. since_hours default 24."
        ),
        parameters={
            "type": "object",
            "properties": {
                "paths": {"type": "array", "items": {"type": "string"}},
                "since_hours": {"type": "integer", "description": "1-336"},
            },
        },
        fn=standup_draft,
    )
)
