"""Vision tools — bridge to the local vision sidecar (port 8765)."""

from __future__ import annotations

import asyncio

import httpx

from .base import ToolSpec, registry

VISION_BASE = "http://127.0.0.1:8765"
HTTP_TIMEOUT = 30.0


async def screenshot_take(path: str = "/tmp/xjarvis_screen.png") -> str:
    """Capture macOS screen via screencapture (no UI prompt with -x)."""
    proc = await asyncio.create_subprocess_exec(
        "screencapture",
        "-x",
        path,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        return f"ERROR: {err.decode().strip()}"
    return f"OK: saved to {path}"


async def screen_look(
    query: str = "Ekranda ne görüyorsun? Önemli detayları söyle.",
) -> str:
    """EKRANIMA BAK: masaüstü ekran görüntüsünü al + Claude vision ile analiz et."""
    import os
    import time

    path = f"/tmp/xjarvis_screenlook_{int(time.time())}.png"
    res = await screenshot_take(path)  # mevcut güvenli ekran-görüntüsü fonksiyonu
    if not res.startswith("OK") or not os.path.exists(path):
        return f"ERROR: ekran görüntüsü alınamadı ({res})"
    from agent.llm.anthropic_vision import analyze_image_file

    try:
        return await analyze_image_file(path, query)
    finally:
        try:
            os.remove(path)
        except Exception:
            pass


async def vision_analyze(
    query: str = "Bu görselde ne var? 1-2 cümleyle özetle.",
) -> str:
    """Capture from the camera (vision sidecar) and analyze with the configured LLM."""
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as c:
        try:
            r = await c.post(f"{VISION_BASE}/capture", json={"query": query})
        except httpx.HTTPError as e:
            return f"ERROR: vision sidecar unreachable ({e})"
    if r.status_code != 200:
        return f"ERROR: vision returned {r.status_code}"
    data = r.json()
    summary = data.get("summary") or data.get("text") or data.get("description")
    if summary:
        return str(summary)
    return str(data)


async def vision_status() -> str:
    async with httpx.AsyncClient(timeout=3.0) as c:
        try:
            r = await c.get(f"{VISION_BASE}/status")
        except httpx.HTTPError as e:
            return f"DOWN: {e}"
    return f"UP: {r.text[:200]}" if r.status_code == 200 else f"DOWN: {r.status_code}"


for spec in [
    ToolSpec(
        name="screenshot_take",
        description=(
            "Ekran görüntüsü al ve dosyaya kaydet. Yan etki yok, sessizce çalışır. "
            "Path verilmezse /tmp/xjarvis_screen.png'e kaydeder."
        ),
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string"}},
        },
        fn=screenshot_take,
    ),
    ToolSpec(
        name="screen_look",
        description=(
            "EKRANIMA BAK: masaüstü ekran görüntüsünü alıp Claude vision ile analiz eder. "
            "'ekranıma bak', 'bu hatayı çöz', 'ekranda ne yazıyor', 'şunu oku/açıkla' gibi "
            "kullanıcının EKRANINI görmen gereken her durumda kullan."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Ekrana dair Türkçe soru/görev",
                },
            },
        },
        fn=screen_look,
    ),
    ToolSpec(
        name="vision_analyze",
        description=(
            "Vision sidecar'dan KAMERA görüntüsünü al ve analiz et. "
            "'Önümde ne var?', 'masada ne görüyorsun?' gibi sorular için."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Türkçe analiz sorusu"},
            },
        },
        fn=vision_analyze,
    ),
    ToolSpec(
        name="vision_status",
        description="Vision sidecar (kamera servisi) çalışıyor mu kontrol et.",
        parameters={"type": "object", "properties": {}},
        fn=vision_status,
    ),
]:
    registry.register(spec)
