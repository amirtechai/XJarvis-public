"""Screen automation — click, type, key press, screen dimensions.

Uses macOS `cliclick` if installed (best UX, supports color picking, mouse path).
Falls back to AppleScript System Events for click + keystroke.

Install cliclick:  brew install cliclick
"""
from __future__ import annotations

import asyncio
import shutil

from .base import ToolSpec, registry

HAS_CLICLICK = shutil.which("cliclick") is not None


async def _run(cmd: list[str]) -> str:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return f"ERROR: {stderr.decode().strip()}"
    return stdout.decode().strip() or "OK"


async def screen_size() -> str:
    """Return screen width × height in pixels."""
    return await _run([
        "osascript", "-e",
        'tell application "Finder" to get bounds of window of desktop',
    ])


async def screen_click(x: int, y: int, button: str = "left") -> str:
    """Click at absolute screen coordinates. button: left | right | double."""
    if HAS_CLICLICK:
        flag = {"left": "c", "right": "rc", "double": "dc"}.get(button, "c")
        return await _run(["cliclick", f"{flag}:{int(x)},{int(y)}"])
    # Fallback via AppleScript: only supports left click in System Events
    if button != "left":
        return f"ERROR: {button} click needs cliclick (brew install cliclick)"
    script = f'''
    tell application "System Events"
      click at {{{int(x)}, {int(y)}}}
    end tell
    return "OK"
    '''
    return await _run(["osascript", "-e", script])


async def screen_move(x: int, y: int) -> str:
    """Move cursor without clicking."""
    if not HAS_CLICLICK:
        return "ERROR: needs cliclick (brew install cliclick)"
    return await _run(["cliclick", f"m:{int(x)},{int(y)}"])


async def screen_type(text: str) -> str:
    """Type text wherever the cursor is."""
    if HAS_CLICLICK:
        # cliclick t: types literally; w:50 is 50ms wait between keys
        return await _run(["cliclick", "-w", "20", f"t:{text}"])
    safe = text.replace('"', '\\"').replace('\\', '\\\\')
    script = f'tell application "System Events" to keystroke "{safe}"'
    return await _run(["osascript", "-e", script])


async def screen_key(key: str, modifiers: str = "") -> str:
    """Press a single key with optional modifiers.

    key: name from System Events (e.g. 'return', 'tab', 'escape', 'space',
         'left arrow', 'a', 'F5')
    modifiers: comma-separated subset of {command, option, control, shift}
    """
    using = ""
    if modifiers:
        parts = [m.strip() + " down" for m in modifiers.split(",") if m.strip()]
        if parts:
            using = " using {" + ", ".join(parts) + "}"
    # System Events distinguishes 'keystroke' (printable) vs 'key code' (special).
    # Map common names to key codes; fall back to keystroke for printables.
    KEY_CODES = {
        "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51,
        "escape": 53, "esc": 53, "left arrow": 123, "right arrow": 124,
        "down arrow": 125, "up arrow": 126,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
        "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    }
    code = KEY_CODES.get(key.lower())
    if code is not None:
        script = f'tell application "System Events" to key code {code}{using}'
    else:
        safe = key.replace('"', '\\"').replace('\\', '\\\\')
        script = f'tell application "System Events" to keystroke "{safe}"{using}'
    return await _run(["osascript", "-e", script])


async def screen_drag(x1: int, y1: int, x2: int, y2: int) -> str:
    """Drag from (x1,y1) to (x2,y2)."""
    if not HAS_CLICLICK:
        return "ERROR: needs cliclick (brew install cliclick)"
    return await _run([
        "cliclick", f"dd:{int(x1)},{int(y1)}", f"du:{int(x2)},{int(y2)}",
    ])


async def screen_color(x: int, y: int) -> str:
    """Sample pixel color at (x,y) — returns RGB hex."""
    if not HAS_CLICLICK:
        return "ERROR: needs cliclick (brew install cliclick)"
    return await _run(["cliclick", f"cp:{int(x)},{int(y)}"])


for spec in [
    ToolSpec(
        name="screen_size",
        description="Ekran boyutlarını döndür (Finder bounds).",
        parameters={"type": "object", "properties": {}},
        fn=screen_size,
    ),
    ToolSpec(
        name="screen_click",
        description=(
            "Ekrandaki mutlak konuma tıkla. button='left' (default), 'right' veya 'double'. "
            "right ve double cliclick gerektirir (brew install cliclick)."
        ),
        parameters={
            "type": "object",
            "properties": {
                "x": {"type": "integer"},
                "y": {"type": "integer"},
                "button": {"type": "string", "enum": ["left", "right", "double"]},
            },
            "required": ["x", "y"],
        },
        fn=screen_click,
    ),
    ToolSpec(
        name="screen_move",
        description="Cursor'u tıklamadan taşı (cliclick gerekli).",
        parameters={
            "type": "object",
            "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
            "required": ["x", "y"],
        },
        fn=screen_move,
    ),
    ToolSpec(
        name="screen_type",
        description="Cursor'un olduğu yere metin yaz.",
        parameters={
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
        fn=screen_type,
    ),
    ToolSpec(
        name="screen_key",
        description=(
            "Tek tuşa bas. key: 'return', 'tab', 'escape', 'space', 'left arrow', 'F5', "
            "veya tek karakter ('a'). modifiers: virgülle ayrılmış {command, option, "
            "control, shift} alt kümesi (örn 'command,shift')."
        ),
        parameters={
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "modifiers": {"type": "string"},
            },
            "required": ["key"],
        },
        fn=screen_key,
    ),
    ToolSpec(
        name="screen_drag",
        description="Sürükle: (x1,y1)'den (x2,y2)'ye (cliclick gerekli).",
        parameters={
            "type": "object",
            "properties": {
                "x1": {"type": "integer"}, "y1": {"type": "integer"},
                "x2": {"type": "integer"}, "y2": {"type": "integer"},
            },
            "required": ["x1", "y1", "x2", "y2"],
        },
        fn=screen_drag,
    ),
    ToolSpec(
        name="screen_color",
        description="Bir pikselin rengini al (RGB hex). cliclick gerekli.",
        parameters={
            "type": "object",
            "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
            "required": ["x", "y"],
        },
        fn=screen_color,
    ),
]:
    registry.register(spec)
