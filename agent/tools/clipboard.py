"""Clipboard read/write."""
from __future__ import annotations

import asyncio

from .base import ToolSpec, registry


async def clipboard_read() -> str:
    proc = await asyncio.create_subprocess_exec(
        "pbpaste", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, _ = await proc.communicate()
    return stdout.decode("utf-8", errors="replace")


async def clipboard_write(text: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        "pbcopy", stdin=asyncio.subprocess.PIPE,
    )
    await proc.communicate(text.encode("utf-8"))
    return f"OK: {len(text)} chars copied"


registry.register(ToolSpec(
    name="clipboard_read",
    description="macOS clipboard içeriğini oku.",
    parameters={"type": "object", "properties": {}},
    fn=clipboard_read,
))
registry.register(ToolSpec(
    name="clipboard_write",
    description="macOS clipboard'a yaz.",
    parameters={
        "type": "object",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
    },
    fn=clipboard_write,
))
