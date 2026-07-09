"""In-memory workflow recorder.

When a recording is active, every tool call (name + args + truncated result)
is appended. On stop, the captured trace is rendered as a Markdown skill
in agent/skills/ so future sessions can re-run the workflow.
"""
from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


@dataclass
class _Step:
    tool: str
    args: dict
    result: str
    ts: float


@dataclass
class _Session:
    name: str
    description: str
    started_at: float
    steps: list[_Step] = field(default_factory=list)


_lock = threading.Lock()
_active: _Session | None = None


def _slug(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9가-힣ğüşıöçĞÜŞİÖÇ\- ]+", "", s).strip().lower()
    s = re.sub(r"\s+", "-", s)
    return s or f"workflow-{int(time.time())}"


def is_recording() -> bool:
    return _active is not None


def start(name: str, description: str = "") -> str:
    global _active
    with _lock:
        if _active is not None:
            return f"ERROR: zaten kayıt var ('{_active.name}'); önce recorder_stop çalıştır"
        _active = _Session(
            name=name.strip() or "workflow",
            description=description.strip(),
            started_at=time.time(),
        )
    return f"OK: '{_active.name}' kaydı başladı"


def log(tool: str, args: dict, result: str) -> None:
    with _lock:
        if _active is None:
            return
        # Don't log the recorder itself
        if tool.startswith("recorder_"):
            return
        _active.steps.append(_Step(
            tool=tool,
            args=dict(args or {}),
            result=(result or "")[:300],
            ts=time.time(),
        ))


def status() -> str:
    with _lock:
        if _active is None:
            return "IDLE"
        elapsed = int(time.time() - _active.started_at)
        return f"RECORDING '{_active.name}' · {len(_active.steps)} adım · {elapsed}s"


def cancel() -> str:
    global _active
    with _lock:
        if _active is None:
            return "IDLE"
        name = _active.name
        _active = None
    return f"OK: '{name}' iptal edildi"


def stop() -> str:
    """Stop current recording and write a skill markdown. Returns the file path."""
    global _active
    with _lock:
        if _active is None:
            return "ERROR: aktif kayıt yok"
        session = _active
        _active = None

    if not session.steps:
        return f"WARN: '{session.name}' boş — kayıt atıldı"

    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    slug = _slug(session.name)
    path = SKILLS_DIR / f"{slug}.md"
    if path.exists():
        path = SKILLS_DIR / f"{slug}-{int(session.started_at)}.md"

    md = _render(session, slug)
    path.write_text(md, encoding="utf-8")
    return f"OK: skill yazıldı → {path}"


def _render(session: _Session, slug: str) -> str:
    desc = session.description or f"Kaydedilmiş iş akışı ({len(session.steps)} adım)"
    lines: list[str] = []
    lines.append("---")
    lines.append(f"name: {slug}")
    lines.append(f"description: {desc}")
    lines.append("---")
    lines.append("")
    lines.append(f"# {session.name}")
    lines.append("")
    lines.append("Bu skill, kullanıcının `recorder_start` ile başlattığı bir oturumdan")
    lines.append("otomatik üretildi. Aşağıdaki adımları sırayla çalıştır:")
    lines.append("")

    for i, step in enumerate(session.steps, 1):
        args_short = _format_args(step.args)
        lines.append(f"{i}. `{step.tool}({args_short})`")
        if step.result and step.result.strip() and step.result.strip() != "OK":
            r = step.result.replace("\n", " ").strip()[:140]
            lines.append(f"   → kayıt anında dönen: `{r}`")
    lines.append("")
    lines.append("## Notlar")
    lines.append("")
    lines.append("- Kayıt anında çalışan ortama göre özelleştirildi (URL'ler, ekran konumları, "
                 "uygulama adları). Yeniden çalıştırırken aynı koşulları varsay.")
    lines.append("- Tıklama koordinatları varsa farklı çözünürlükte yanlış olabilir; "
                 "şüpheli durumlarda `computer_use(goal=…)` ile tekrarla.")
    lines.append("")
    return "\n".join(lines)


def _format_args(args: dict) -> str:
    if not args:
        return ""
    parts = []
    for k, v in args.items():
        if isinstance(v, str):
            v_short = v if len(v) < 80 else v[:77] + "..."
            parts.append(f'{k}="{v_short}"')
        else:
            parts.append(f"{k}={v!r}")
    return ", ".join(parts)
