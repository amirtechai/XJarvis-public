"""File read/write — full filesystem access (kişisel kullanım)."""
from __future__ import annotations

from pathlib import Path

from .base import ToolSpec, registry

MAX_READ_BYTES = 200_000


async def file_read(path: str, max_bytes: int = MAX_READ_BYTES) -> str:
    """Read a file. Path can use ~ for home."""
    p = Path(path).expanduser()
    if not p.exists():
        return f"ERROR: not found — {p}"
    if p.is_dir():
        return f"ERROR: is a directory — {p}"
    try:
        data = p.read_bytes()[:max_bytes]
        return data.decode("utf-8", errors="replace")
    except Exception as e:
        return f"ERROR: {e}"


async def file_write(path: str, content: str, append: bool = False) -> str:
    """Write or append to a file. Creates parent dirs."""
    p = Path(path).expanduser()
    p.parent.mkdir(parents=True, exist_ok=True)
    mode = "a" if append else "w"
    try:
        with p.open(mode, encoding="utf-8") as f:
            f.write(content)
        return f"OK: wrote {len(content)} chars to {p}"
    except Exception as e:
        return f"ERROR: {e}"


async def list_dir(path: str) -> str:
    """List directory entries."""
    p = Path(path).expanduser()
    if not p.is_dir():
        return f"ERROR: not a directory — {p}"
    entries = []
    for child in sorted(p.iterdir()):
        kind = "d" if child.is_dir() else "f"
        size = child.stat().st_size if child.is_file() else 0
        entries.append(f"{kind} {size:>10}  {child.name}")
    return "\n".join(entries) or "(empty)"


for spec in [
    ToolSpec(
        name="file_read",
        description="Dosya içeriğini oku. ~ ev dizini için.",
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        fn=file_read,
    ),
    ToolSpec(
        name="file_write",
        description="Dosyaya yaz. append=true ile ekle, false ile üzerine yaz.",
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
                "append": {"type": "boolean"},
            },
            "required": ["path", "content"],
        },
        fn=file_write,
    ),
    ToolSpec(
        name="list_dir",
        description="Dizin içeriğini listele.",
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        fn=list_dir,
    ),
]:
    registry.register(spec)
