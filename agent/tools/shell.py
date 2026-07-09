"""Full shell access — kişisel kullanım, kısıtlama yok. Audit log her komutu kaydeder."""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from .base import ToolSpec, registry

AUDIT_LOG = Path(__file__).resolve().parent.parent.parent / "logs" / "agent-audit.jsonl"
AUDIT_LOG.parent.mkdir(exist_ok=True)
DEFAULT_TIMEOUT_S = 30


async def shell_exec(command: str, timeout: int = DEFAULT_TIMEOUT_S) -> str:
    """Execute a shell command. Returns stdout+stderr+exit_code as JSON-ish text."""
    timeout = max(1, min(int(timeout), 300))
    started = time.time()
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return f"TIMEOUT after {timeout}s"
        out = stdout.decode("utf-8", errors="replace").strip()
        err = stderr.decode("utf-8", errors="replace").strip()
        rc = proc.returncode
    finally:
        with AUDIT_LOG.open("a") as f:
            f.write(json.dumps({
                "ts": started,
                "tool": "shell_exec",
                "command": command,
                "duration_ms": int((time.time() - started) * 1000),
            }) + "\n")

    parts = [f"exit={rc}"]
    if out:
        parts.append(f"stdout:\n{out[:4000]}")
    if err:
        parts.append(f"stderr:\n{err[:2000]}")
    return "\n".join(parts)


registry.register(ToolSpec(
    name="shell_exec",
    description=(
        "macOS shell komutu çalıştır. Tam yetki: open -a (uygulama aç), osascript "
        "(AppleScript), pbcopy/pbpaste (clipboard), screencapture, defaults, brew, "
        "git, vs. Uygulama açmak için: open -a Safari veya open -a 'Google Chrome' "
        "https://example.com. URL açmak için: open https://...."
    ),
    parameters={
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Çalıştırılacak shell komutu"},
            "timeout": {"type": "integer", "description": "Saniye (varsayılan 30, max 300)"},
        },
        "required": ["command"],
    },
    fn=shell_exec,
))
