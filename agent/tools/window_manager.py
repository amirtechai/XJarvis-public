"""Window manager — tile, move, resize, mission control via AppleScript.

macOS Sequoia exposes window tiling through the Window menu, but driving it via
keyboard shortcuts is unreliable across apps. We use System Events to set the
frontmost window's bounds directly — works for any standard Cocoa window.
"""
from __future__ import annotations

import asyncio
import re
import subprocess

from .base import ToolSpec, registry


async def _osa(script: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        "osascript", "-e", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        return f"ERROR: {err.decode().strip()}"
    return out.decode().strip() or "OK"


def _screen_size() -> tuple[int, int]:
    try:
        out = subprocess.check_output(
            ["system_profiler", "SPDisplaysDataType"], text=True, timeout=3
        )
    except Exception:
        return (1920, 1080)
    m = re.search(r"Resolution:\s*(\d+)\s*x\s*(\d+)", out)
    if m:
        return int(m.group(1)), int(m.group(2))
    return (1920, 1080)


MENU_BAR_HEIGHT = 25  # leave room for menu bar


async def _set_frontmost_bounds(x: int, y: int, w: int, h: int) -> str:
    script = f'''
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      tell frontApp
        if (count of windows) is 0 then return "ERROR: no window"
        set position of front window to {{{x}, {y}}}
        set size of front window to {{{w}, {h}}}
      end tell
    end tell
    return "OK"
    '''
    return await _osa(script)


async def window_tile(position: str = "left") -> str:
    """Tile frontmost window. position: left | right | top | bottom |
    top-left | top-right | bottom-left | bottom-right | maximize | center."""
    sw, sh = _screen_size()
    usable_y = MENU_BAR_HEIGHT
    usable_h = sh - MENU_BAR_HEIGHT
    half_w = sw // 2
    half_h = usable_h // 2
    pos = position.lower().strip()

    layouts = {
        "left":         (0,        usable_y, half_w, usable_h),
        "right":        (half_w,   usable_y, half_w, usable_h),
        "top":          (0,        usable_y, sw,     half_h),
        "bottom":       (0,        usable_y + half_h, sw, half_h),
        "top-left":     (0,        usable_y, half_w, half_h),
        "top-right":    (half_w,   usable_y, half_w, half_h),
        "bottom-left":  (0,        usable_y + half_h, half_w, half_h),
        "bottom-right": (half_w,   usable_y + half_h, half_w, half_h),
        "maximize":     (0,        usable_y, sw,     usable_h),
        "center":       (sw // 4,  usable_y + usable_h // 8, sw // 2, usable_h * 3 // 4),
    }
    if pos not in layouts:
        return f"ERROR: unknown position '{position}'. Try: {', '.join(layouts)}"
    x, y, w, h = layouts[pos]
    return await _set_frontmost_bounds(x, y, w, h)


async def window_move(x: int, y: int, w: int, h: int) -> str:
    """Move/resize frontmost window to absolute (x,y,w,h)."""
    return await _set_frontmost_bounds(int(x), int(y), int(w), int(h))


async def window_minimize() -> str:
    """Minimize the frontmost window."""
    script = '''
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      tell frontApp to set value of attribute "AXMinimized" of front window to true
    end tell
    return "OK"
    '''
    return await _osa(script)


async def window_list_apps() -> str:
    """List visible app names with window counts (frontmost first)."""
    script = '''
    tell application "System Events"
      set out to ""
      repeat with p in (every process whose visible is true)
        try
          set out to out & (name of p) & ": " & (count of windows of p) & "\n"
        end try
      end repeat
      return out
    end tell
    '''
    return await _osa(script)


async def mission_control(mode: str = "all") -> str:
    """Mission Control. mode: all (Ctrl+Up) | app (Ctrl+Down) | desktop (F11)."""
    m = mode.lower().strip()
    if m == "all":
        script = 'tell application "System Events" to key code 126 using control down'
    elif m == "app":
        script = 'tell application "System Events" to key code 125 using control down'
    elif m == "desktop":
        # Show desktop — fn+F11 on most setups; AppleScript via key code 103 (F11)
        script = 'tell application "System Events" to key code 103 using {function down}'
    else:
        return f"ERROR: mode must be all|app|desktop, got '{mode}'"
    return await _osa(script)


async def space_switch(direction: str = "next") -> str:
    """Switch Space. direction: next (Ctrl+Right) | prev (Ctrl+Left)."""
    d = direction.lower().strip()
    code = 124 if d == "next" else 123 if d == "prev" else None
    if code is None:
        return f"ERROR: direction must be next|prev"
    return await _osa(
        f'tell application "System Events" to key code {code} using control down'
    )


for spec in [
    ToolSpec(
        name="window_tile",
        description=(
            "Frontmost pencereyi konumla. position: left | right | top | bottom | "
            "top-left | top-right | bottom-left | bottom-right | maximize | center."
        ),
        parameters={
            "type": "object",
            "properties": {
                "position": {
                    "type": "string",
                    "enum": [
                        "left", "right", "top", "bottom",
                        "top-left", "top-right", "bottom-left", "bottom-right",
                        "maximize", "center",
                    ],
                },
            },
            "required": ["position"],
        },
        fn=window_tile,
    ),
    ToolSpec(
        name="window_move",
        description="Frontmost pencereyi mutlak (x,y,w,h) konumuna taşı/yeniden boyutlandır.",
        parameters={
            "type": "object",
            "properties": {
                "x": {"type": "integer"}, "y": {"type": "integer"},
                "w": {"type": "integer"}, "h": {"type": "integer"},
            },
            "required": ["x", "y", "w", "h"],
        },
        fn=window_move,
    ),
    ToolSpec(
        name="window_minimize",
        description="Frontmost pencereyi minimize et (Dock'a indir).",
        parameters={"type": "object", "properties": {}},
        fn=window_minimize,
    ),
    ToolSpec(
        name="window_list_apps",
        description="Görünür uygulamaları ve pencere sayılarını listele.",
        parameters={"type": "object", "properties": {}},
        fn=window_list_apps,
    ),
    ToolSpec(
        name="mission_control",
        description=(
            "Mission Control aç. mode: 'all' (tüm pencereler), 'app' (aktif app pencereleri), "
            "'desktop' (masaüstünü göster)."
        ),
        parameters={
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["all", "app", "desktop"]},
            },
        },
        fn=mission_control,
    ),
    ToolSpec(
        name="space_switch",
        description="Space (sanal masaüstü) değiştir. direction: 'next' | 'prev'.",
        parameters={
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["next", "prev"]},
            },
        },
        fn=space_switch,
    ),
]:
    registry.register(spec)
