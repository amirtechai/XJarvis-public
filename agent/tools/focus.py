"""Focus mode — quit distracting apps, attempt DND, optionally start music.

macOS Focus/Do Not Disturb cannot be toggled directly via AppleScript on modern
versions. We try the `shortcuts` CLI with common user-created names; if none
exist, we still get the value of muting apps + starting music. The user can
create a Shortcuts → "Set Focus" shortcut named exactly `xjarvis-focus-on` /
`xjarvis-focus-off` for full DND control.
"""
from __future__ import annotations

import asyncio

from .base import ToolSpec, registry

DEFAULT_CLOSE = ["Slack", "Mail", "Discord", "Messages", "Telegram", "WhatsApp"]
DND_SHORTCUTS_ON = ["xjarvis-focus-on", "Focus On", "Do Not Disturb On", "Turn On Do Not Disturb"]
DND_SHORTCUTS_OFF = ["xjarvis-focus-off", "Focus Off", "Do Not Disturb Off", "Turn Off Do Not Disturb"]


async def _run(cmd: list[str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return proc.returncode, (out.decode() + err.decode()).strip()


async def _osa(script: str) -> tuple[int, str]:
    return await _run(["osascript", "-e", script])


async def _try_shortcut(names: list[str]) -> str:
    """Try a list of shortcut names; return name that worked or 'none'."""
    rc, names_out = await _run(["shortcuts", "list"])
    if rc != 0:
        return f"shortcuts CLI unavailable ({names_out[:80]})"
    available = {n.strip() for n in names_out.splitlines() if n.strip()}
    for name in names:
        if name in available:
            rc, out = await _run(["shortcuts", "run", name])
            if rc == 0:
                return f"ran shortcut '{name}'"
            return f"shortcut '{name}' failed: {out[:80]}"
    return "no matching shortcut found (create one named 'xjarvis-focus-on')"


async def _quit_app(app: str) -> str:
    rc, out = await _osa(f'tell application "{app}" to quit')
    if rc != 0:
        # App may not be running; not an error
        return f"{app}: not running"
    return f"{app}: quit"


async def _start_music(music_app: str, playlist: str) -> str:
    if music_app.lower() in ("spotify",):
        if playlist:
            uri_or_name = playlist
            script = (
                f'tell application "Spotify"\n'
                f'  activate\n'
                f'  play track "{uri_or_name}"\n'
                f'end tell'
            )
        else:
            script = 'tell application "Spotify" to play'
        rc, out = await _osa(script)
        return f"Spotify: {'OK' if rc == 0 else out[:80]}"

    # Apple Music
    if playlist:
        script = (
            f'tell application "Music"\n'
            f'  activate\n'
            f'  try\n'
            f'    play playlist "{playlist}"\n'
            f'  on error\n'
            f'    play\n'
            f'  end try\n'
            f'end tell'
        )
    else:
        script = 'tell application "Music" to play'
    rc, out = await _osa(script)
    return f"Music: {'OK' if rc == 0 else out[:80]}"


async def focus_start(
    close_apps: list[str] | None = None,
    music_app: str = "",
    playlist: str = "",
) -> str:
    """Start focus mode: quit distractors, attempt DND, optionally play music."""
    apps = close_apps if close_apps else DEFAULT_CLOSE
    lines: list[str] = ["Focus ON"]

    dnd = await _try_shortcut(DND_SHORTCUTS_ON)
    lines.append(f"DND: {dnd}")

    for app in apps:
        lines.append(f"close: {await _quit_app(app)}")

    if music_app:
        lines.append(f"music: {await _start_music(music_app, playlist)}")

    return "\n".join(lines)


async def focus_stop(reopen_apps: list[str] | None = None, stop_music: bool = False) -> str:
    """Stop focus mode: disable DND, optionally reopen apps and pause music."""
    lines: list[str] = ["Focus OFF"]

    dnd = await _try_shortcut(DND_SHORTCUTS_OFF)
    lines.append(f"DND: {dnd}")

    for app in (reopen_apps or []):
        rc, out = await _run(["open", "-a", app])
        lines.append(f"reopen {app}: {'OK' if rc == 0 else out[:60]}")

    if stop_music:
        rc1, _ = await _osa('tell application "Music" to pause')
        rc2, _ = await _osa('tell application "Spotify" to pause')
        lines.append(f"music paused: Music={rc1==0} Spotify={rc2==0}")

    return "\n".join(lines)


async def focus_status() -> str:
    """Best-effort report of focus state."""
    rc, out = await _run(["defaults", "read", "com.apple.controlcenter", "NSStatusItem Visible FocusModes"])
    visible = out.strip() if rc == 0 else "?"
    rc2, music = await _osa('tell application "Music" to player state as text')
    rc3, spotify = await _osa('tell application "Spotify" to player state as text')
    return (
        f"focus_menu_visible={visible}\n"
        f"music_state={music if rc2 == 0 else 'n/a'}\n"
        f"spotify_state={spotify if rc3 == 0 else 'n/a'}"
    )


for spec in [
    ToolSpec(
        name="focus_start",
        description=(
            "Focus modu aç: dikkat dağıtan uygulamaları kapat, DND aç (Shortcuts CLI'sı ile), "
            "opsiyonel olarak müzik başlat. close_apps verilmezse "
            "[Slack, Mail, Discord, Messages, Telegram, WhatsApp]."
        ),
        parameters={
            "type": "object",
            "properties": {
                "close_apps": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Kapatılacak app adları",
                },
                "music_app": {
                    "type": "string",
                    "enum": ["", "Music", "Spotify"],
                    "description": "Müzik uygulaması; boş = müzik açma",
                },
                "playlist": {
                    "type": "string",
                    "description": "Çalınacak playlist adı (opsiyonel)",
                },
            },
        },
        fn=focus_start,
    ),
    ToolSpec(
        name="focus_stop",
        description="Focus modu kapat: DND kapat, opsiyonel olarak app'leri yeniden aç, müziği durdur.",
        parameters={
            "type": "object",
            "properties": {
                "reopen_apps": {"type": "array", "items": {"type": "string"}},
                "stop_music": {"type": "boolean"},
            },
        },
        fn=focus_stop,
    ),
    ToolSpec(
        name="focus_status",
        description="Focus / DND durumu ve müzik oynatıcı durumu.",
        parameters={"type": "object", "properties": {}},
        fn=focus_status,
    ),
]:
    registry.register(spec)
