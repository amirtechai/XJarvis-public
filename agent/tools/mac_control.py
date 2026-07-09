"""macOS native control via osascript — windows, apps, system actions."""
from __future__ import annotations

import asyncio

from .base import ToolSpec, registry


async def _run_osascript(script: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        "osascript", "-e", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return f"ERROR: {stderr.decode().strip()}"
    return stdout.decode().strip() or "OK"


async def open_app(app_name: str, url: str | None = None) -> str:
    """Open a macOS application. Optionally with a URL (Safari, Chrome, etc.)."""
    cmd = ["open", "-a", app_name]
    if url:
        cmd.append(url)
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        return f"ERROR: {stderr.decode().strip()}"
    return f"Opened {app_name}" + (f" → {url}" if url else "")


async def applescript(script: str) -> str:
    """Run arbitrary AppleScript. Use for: tell application, system events, dialogs, vs."""
    return await _run_osascript(script)


async def notify(title: str, message: str) -> str:
    """Show macOS notification."""
    safe_t = title.replace('"', "'")
    safe_m = message.replace('"', "'")
    return await _run_osascript(
        f'display notification "{safe_m}" with title "{safe_t}"'
    )


async def frontmost_app() -> str:
    """Return name of the currently focused app."""
    return await _run_osascript(
        'tell application "System Events" to name of first application process whose frontmost is true'
    )


registry.register(ToolSpec(
    name="open_app",
    description=(
        "macOS uygulamasını aç. URL parametresi verilirse o URL ile aç (Safari/Chrome). "
        "Örnekler: open_app('Safari', 'https://hava.com.tr'), open_app('Spotify'), "
        "open_app('Visual Studio Code')."
    ),
    parameters={
        "type": "object",
        "properties": {
            "app_name": {"type": "string", "description": "Uygulama adı (örn. 'Safari')"},
            "url": {"type": "string", "description": "Opsiyonel: birlikte açılacak URL"},
        },
        "required": ["app_name"],
    },
    fn=open_app,
))

registry.register(ToolSpec(
    name="applescript",
    description=(
        "AppleScript çalıştır. macOS özel kontrolleri için: pencere yönetimi, "
        "Music/Spotify kontrol, Mail gönder, Calendar, Reminders, Finder, vs. "
        "Örnek: 'tell application \"Music\" to play'"
    ),
    parameters={
        "type": "object",
        "properties": {
            "script": {"type": "string", "description": "AppleScript kodu"},
        },
        "required": ["script"],
    },
    fn=applescript,
))

registry.register(ToolSpec(
    name="notify",
    description="macOS bildirim göster (sağ üst köşede).",
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "message": {"type": "string"},
        },
        "required": ["title", "message"],
    },
    fn=notify,
))

registry.register(ToolSpec(
    name="frontmost_app",
    description="Şu an aktif/odakta olan uygulamanın adını döndür.",
    parameters={"type": "object", "properties": {}},
    fn=frontmost_app,
))
