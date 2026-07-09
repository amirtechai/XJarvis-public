"""Computer-use loop — iterative screenshot + vision-LLM + click/type until goal met.

Single high-level tool: agent says `computer_use(goal="Spotify'da Daft Punk çal")`,
this module runs screenshot → vision analysis → action → repeat for up to N steps.
"""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
from pathlib import Path

from ..llm.anthropic_vision import analyze_image_file
from .base import ToolSpec, registry
from .screen import screen_click, screen_key, screen_type
from .vision import screenshot_take

TMP_DIR = Path("/tmp")

PLANNER_PROMPT = """You drive a macOS computer to accomplish the user's goal.
You receive a screenshot at each step. Decide ONE next action.

Reply with ONLY a single JSON object, no prose, no markdown fences:
{
  "thought": "<short reasoning>",
  "action": "click" | "double_click" | "right_click" | "type" | "key" | "done" | "fail",
  "x": <0..1 relative x, only for click actions>,
  "y": <0..1 relative y, only for click actions>,
  "text": "<text to type, only for type>",
  "key": "<key name e.g. return, tab, escape, space, F5, a>",
  "modifiers": "<comma list: command,option,control,shift>",
  "reason": "<short why done/fail>"
}

Coordinates are RELATIVE (0..1) of the full screenshot. (0,0)=top-left.
- "done": goal already visible/accomplished on this screen
- "fail": goal unreachable (e.g. login required, blocked dialog)
Keep "thought" under 20 words. One action per step."""


def _read_screen_size() -> tuple[int, int]:
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


def _strip_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s)
    return s.strip()


async def _ask_planner(
    goal: str, image_path: Path, history: list[dict], size: tuple[int, int]
) -> dict:
    """Bir sonraki aksiyonu Claude'un görüntü yeteneğiyle (abonelik kredisi) seç."""
    history_summary = (
        "\n".join(
            f"- step {i + 1}: {h.get('action')} {h.get('thought', '')[:80]}"
            for i, h in enumerate(history[-5:])
        )
        or "(no prior steps)"
    )

    prompt = (
        f"{PLANNER_PROMPT}\n\n"
        f"GOAL: {goal}\n"
        f"SCREEN_SIZE: {size[0]}x{size[1]}\n"
        f"HISTORY:\n{history_summary}\n\n"
        "Decide the next action. Reply with ONLY the JSON object."
    )

    raw = await analyze_image_file(str(image_path), prompt)
    if raw.startswith("ERROR:"):
        return {"action": "fail", "reason": raw}
    try:
        return json.loads(_strip_fences(raw))
    except json.JSONDecodeError as e:
        return {"action": "fail", "reason": f"parse error: {e}"}


async def computer_use(goal: str, max_steps: int = 6) -> str:
    """Iteratively screenshot + vision + act until goal met or max_steps reached."""
    if not goal or not goal.strip():
        return "ERROR: goal is empty"
    max_steps = max(1, min(int(max_steps), 12))

    width, height = _read_screen_size()
    history: list[dict] = []
    transcript: list[str] = []

    for step in range(max_steps):
        img = TMP_DIR / f"xjarvis_cu_{step}.png"
        cap = await screenshot_take(str(img))
        if cap.startswith("ERROR"):
            return f"step {step + 1}: screenshot failed — {cap}"

        action = await _ask_planner(goal, img, history, (width, height))
        history.append(action)

        kind = (action.get("action") or "").lower()
        thought = action.get("thought", "")
        line = f"step {step + 1}: {kind}"
        if thought:
            line += f" — {thought[:120]}"

        if kind == "done":
            transcript.append(line)
            transcript.append(f"DONE: {action.get('reason', 'goal reached')}")
            return "\n".join(transcript)

        if kind == "fail":
            transcript.append(line)
            transcript.append(f"FAIL: {action.get('reason', 'blocked')}")
            return "\n".join(transcript)

        if kind in ("click", "double_click", "right_click"):
            try:
                rx = float(action.get("x", 0.5))
                ry = float(action.get("y", 0.5))
            except (TypeError, ValueError):
                transcript.append(line + " [bad coords]")
                continue
            ax = round(rx * width)
            ay = round(ry * height)
            btn = {"click": "left", "double_click": "double", "right_click": "right"}[
                kind
            ]
            res = await screen_click(ax, ay, button=btn)
            transcript.append(f"{line} @({ax},{ay}) → {res[:60]}")

        elif kind == "type":
            text = action.get("text", "")
            res = await screen_type(text)
            transcript.append(f"{line} text={text[:40]!r} → {res[:60]}")

        elif kind == "key":
            key = action.get("key", "")
            mods = action.get("modifiers", "") or ""
            res = await screen_key(key, mods)
            transcript.append(f"{line} key={key} mods={mods} → {res[:60]}")

        else:
            transcript.append(line + f" [unknown action '{kind}']")
            continue

        await asyncio.sleep(0.7)

    transcript.append(f"TIMEOUT: {max_steps} steps exhausted, goal not confirmed")
    return "\n".join(transcript)


registry.register(
    ToolSpec(
        name="computer_use",
        description=(
            "Bilgisayarı görerek kontrol et: ekran görüntüsü al → vision LLM ile analiz et → "
            "tıkla/yaz/tuş bas. Hedef tamamlanana ya da max_steps dolana kadar döngü. "
            "Örnek goal: 'Safari'de yeni sekme aç ve apple.com'a git', "
            "'Spotify'da Daft Punk - Get Lucky çal', 'Notes'ta yeni not oluştur'."
        ),
        parameters={
            "type": "object",
            "properties": {
                "goal": {
                    "type": "string",
                    "description": "Doğal dil hedef (TR veya EN). Tek bir somut iş.",
                },
                "max_steps": {
                    "type": "integer",
                    "description": "Maksimum adım (1-12, default 6).",
                },
            },
            "required": ["goal"],
        },
        fn=computer_use,
    )
)
