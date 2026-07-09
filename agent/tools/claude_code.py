"""Claude Code CLI bridge — spawn `claude` with a prompt and capture output.

Uses headless print mode (`claude -p "..."`). Optionally pin a working dir, model,
and additional context files. Output is the assistant's final response.

Requires `claude` CLI in PATH (npm i -g @anthropic-ai/claude-code or installer).
"""
from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path

from .base import ToolSpec, registry


def _which() -> str | None:
    return shutil.which("claude")


async def claude_code(
    prompt: str,
    cwd: str = "",
    model: str = "",
    timeout_sec: int = 240,
    add_context: str = "",
) -> str:
    """Run a one-shot Claude Code task. Returns the assistant response.

    add_context: comma-separated file paths to attach as context (e.g. for code review).
    """
    if not prompt.strip():
        return "ERROR: empty prompt"
    bin_path = _which()
    if not bin_path:
        return "ERROR: `claude` CLI not in PATH (install: npm i -g @anthropic-ai/claude-code)"

    args = [bin_path, "-p", prompt]
    if model:
        args += ["--model", model]

    work_cwd = cwd or str(Path.cwd())
    if not Path(work_cwd).is_dir():
        return f"ERROR: cwd does not exist: {work_cwd}"

    # Append @file context inline if requested
    if add_context.strip():
        files = [p.strip() for p in add_context.split(",") if p.strip()]
        prompt_with = prompt + "\n\nContext files:\n" + "\n".join(f"@{f}" for f in files)
        args[args.index("-p") + 1] = prompt_with

    try:
        proc = await asyncio.create_subprocess_exec(
            *args, cwd=work_cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "FORCE_COLOR": "0"},
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
    except asyncio.TimeoutError:
        return f"ERROR: timeout after {timeout_sec}s"

    text = (out.decode(errors="replace") + err.decode(errors="replace")).strip()
    if proc.returncode != 0 and not text:
        return f"ERROR: claude exited {proc.returncode}"
    return text[:8000]


async def claude_code_install_check() -> str:
    """Diagnose Claude Code availability."""
    bin_path = _which()
    if not bin_path:
        return "MISSING: `claude` not in PATH. Install: npm i -g @anthropic-ai/claude-code"
    proc = await asyncio.create_subprocess_exec(
        bin_path, "--version",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    return f"OK: {bin_path} → {out.decode().strip() or 'no version output'}"


for spec in [
    ToolSpec(
        name="claude_code",
        description=(
            "Claude Code CLI'ı tek-atış (print) modda çalıştır. Bir prompt + opsiyonel cwd + "
            "model + context dosyaları al, asistan cevabını döndür. Uzun kod görevleri için ideal: "
            "'X projesini refactor et', 'Y testlerini yaz', 'Z dosyasını incele'. "
            "Default cwd current working dir; agent'ın kendi root'unda çalıştırmak için <repo-kök> ver."
        ),
        parameters={
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "Claude Code'a verilecek görev"},
                "cwd": {"type": "string", "description": "Çalışma dizini (mutlak path)"},
                "model": {"type": "string", "description": "claude-opus-4-7 / claude-sonnet-4-6 / vb"},
                "timeout_sec": {"type": "integer", "description": "Maksimum süre, default 240"},
                "add_context": {"type": "string", "description": "Virgülle ayrılmış @file path'leri"},
            },
            "required": ["prompt"],
        },
        fn=claude_code,
    ),
    ToolSpec(
        name="claude_code_install_check",
        description="`claude` CLI yüklü mü, hangi versiyonda kontrol et.",
        parameters={"type": "object", "properties": {}},
        fn=claude_code_install_check,
    ),
]:
    registry.register(spec)
