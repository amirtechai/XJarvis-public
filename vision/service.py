"""Vision sidecar entry point.

- Connects to Node event bus on ws://localhost:3001
- Listens for VISION_TRIGGERED events; on demand: capture → analyze → emit VISION_RESULT
- Also responds to direct request envelopes: {"type":"vision_request","query":str}
- Serves MJPEG stream on http://localhost:8765/stream for the HUD camera feed

macOS note: the first run will prompt for camera permission. If launched by
launchd/PM2 before the user has authorized Terminal/Python, the prompt may be
suppressed and capture will fail silently. Run once interactively first:

    python3 -m vision.service

Then grant access in System Settings → Privacy & Security → Camera.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time
from pathlib import Path

from aiohttp import web
from dotenv import load_dotenv
from loguru import logger
import websockets

# Local imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from vision.analyzer import VisionAnalyzer  # noqa: E402
from vision.capture import CameraManager, CameraUnavailableError  # noqa: E402
from vision.memory import VisualMemory  # noqa: E402
from vision.processor import optimize_for_llm, to_jpeg_bytes  # noqa: E402


BUS_URL = os.getenv("JARVIS_BUS_URL", "ws://localhost:3001")
MJPEG_PORT = int(os.getenv("VISION_MJPEG_PORT", "8765"))
CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
logger.remove()
logger.add(sys.stderr, level="INFO")
logger.add(LOG_DIR / "vision.log", rotation="10 MB", retention="7 days", level="DEBUG")


class VisionService:
    def __init__(self) -> None:
        self.camera = CameraManager(index=CAMERA_INDEX)
        self.memory = VisualMemory()
        self.analyzer: VisionAnalyzer | None = None
        try:
            self.analyzer = VisionAnalyzer()
        except RuntimeError as e:
            logger.warning(f"[service] analyzer disabled: {e}")
        self._stop = asyncio.Event()
        self._bus_ws: websockets.WebSocketClientProtocol | None = None
        # Camera defaults to OFF — only opens on explicit /camera/on or /capture
        self._camera_on = False
        self._camera_lock = asyncio.Lock()
        # Auto-close camera after this many seconds of idle (0 = never)
        self._idle_close_s = int(os.getenv("CAMERA_IDLE_CLOSE_S", "30"))
        self._last_use = 0.0
        self._idle_task: asyncio.Task | None = None
        # Manual mode — when the user explicitly toggles camera on via the
        # dashboard, the idle auto-close is suspended so the LED stays lit
        # until the user toggles it off.
        self._manual_keep_alive = False

    async def _ensure_camera_on(self) -> bool:
        async with self._camera_lock:
            if self._camera_on:
                self._last_use = time.time()
                return True
            try:
                self.camera.start()
                self._camera_on = True
                self._last_use = time.time()
                logger.info("[camera] turned ON")
                await self.emit(
                    "SERVICE_HEALTH_CHANGE", {"service": "camera", "status": "on"}
                )
                return True
            except CameraUnavailableError as e:
                logger.error(f"[camera] failed to start: {e}")
                return False

    async def _camera_off(self) -> None:
        async with self._camera_lock:
            if not self._camera_on:
                return
            try:
                self.camera.stop()
            except Exception as e:
                logger.warning(f"[camera] stop failed: {e}")
            self._camera_on = False
            logger.info("[camera] turned OFF")
            await self.emit(
                "SERVICE_HEALTH_CHANGE", {"service": "camera", "status": "off"}
            )

    async def _idle_loop(self) -> None:
        """Auto-close the camera after `_idle_close_s` seconds without use."""
        while not self._stop.is_set():
            await asyncio.sleep(5)
            if self._manual_keep_alive:
                continue
            if (
                self._camera_on
                and self._idle_close_s > 0
                and time.time() - self._last_use > self._idle_close_s
            ):
                logger.info(f"[camera] idle for {self._idle_close_s}s — closing")
                await self._camera_off()

    async def emit(self, event: str, payload: dict, source: str = "vision") -> None:
        if self._bus_ws is None:
            return
        try:
            await self._bus_ws.send(
                json.dumps(
                    {
                        "type": "bus_emit",
                        "event": event,
                        "payload": payload,
                        "source": source,
                    }
                )
            )
        except Exception as e:
            logger.warning(f"[bus] emit failed: {e}")

    async def handle_vision_request(self, query: str = "Bu görselde ne var?") -> dict:
        if self.analyzer is None:
            return {"error": "vision analyzer not configured"}
        await self.emit("VISION_SCANNING", {"query": query})
        # Auto-open camera for the duration of this request
        if not await self._ensure_camera_on():
            return {"error": "camera unavailable"}
        # Give the sensor a beat to deliver a fresh frame on cold start
        await asyncio.sleep(0.4)
        self._last_use = time.time()
        try:
            frame, ts = self.camera.latest()
        except CameraUnavailableError as e:
            logger.error(f"[service] capture failed: {e}")
            return {"error": str(e)}
        b64 = optimize_for_llm(frame)
        try:
            result = await self.analyzer.analyze(b64, query)
        except Exception as e:
            logger.error(f"[service] analyze failed: {e}")
            return {"error": str(e)}
        self.memory.update(result)
        out = result.to_dict()
        out["captured_at"] = ts
        await self.emit("VISION_RESULT", out)
        return out

    async def bus_loop(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with websockets.connect(BUS_URL) as ws:
                    self._bus_ws = ws
                    backoff = 1.0
                    logger.info(f"[bus] connected to {BUS_URL}")
                    await ws.send(
                        json.dumps(
                            {"type": "subscribe", "events": ["VISION_TRIGGERED"]}
                        )
                    )
                    await self.emit(
                        "SERVICE_HEALTH_CHANGE", {"service": "vision", "status": "up"}
                    )
                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if (
                            msg.get("type") == "event"
                            and msg.get("event") == "VISION_TRIGGERED"
                        ):
                            query = (msg.get("payload") or {}).get(
                                "query"
                            ) or "Bu görselde ne var?"
                            await self.handle_vision_request(query)
            except Exception as e:
                self._bus_ws = None
                logger.warning(f"[bus] disconnected: {e}; retry in {backoff:.0f}s")
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=backoff)
                    return
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 1.6, 30.0)

    async def mjpeg_handler(self, request: web.Request) -> web.StreamResponse:
        if not self._camera_on:
            return web.Response(status=503, text="camera off")
        boundary = "frame"
        resp = web.StreamResponse(
            status=200,
            reason="OK",
            headers={
                "Content-Type": f"multipart/x-mixed-replace; boundary={boundary}",
                "Cache-Control": "no-cache, private",
                "Connection": "close",
            },
        )
        await resp.prepare(request)
        try:
            while not self._stop.is_set() and self._camera_on:
                try:
                    frame, _ = self.camera.latest()
                except CameraUnavailableError:
                    await asyncio.sleep(0.5)
                    continue
                self._last_use = time.time()
                jpeg = to_jpeg_bytes(frame, max_long_side=960, quality=70)
                payload = (
                    (
                        f"--{boundary}\r\n"
                        f"Content-Type: image/jpeg\r\n"
                        f"Content-Length: {len(jpeg)}\r\n\r\n"
                    ).encode()
                    + jpeg
                    + b"\r\n"
                )
                await resp.write(payload)
                await asyncio.sleep(1 / 15)  # ~15fps
        except (asyncio.CancelledError, ConnectionResetError):
            pass
        return resp

    async def camera_on_handler(self, _: web.Request) -> web.Response:
        ok = await self._ensure_camera_on()
        # Manual /camera/on means the user wants the LED to stay lit until
        # they explicitly turn it off. Disable the idle auto-close.
        if ok:
            self._manual_keep_alive = True
        return web.json_response(
            {
                "on": self._camera_on,
                "ok": ok,
                "manual_keep_alive": self._manual_keep_alive,
            }
        )

    async def camera_off_handler(self, _: web.Request) -> web.Response:
        self._manual_keep_alive = False
        await self._camera_off()
        return web.json_response(
            {"on": self._camera_on, "ok": True, "manual_keep_alive": False}
        )

    async def camera_state_handler(self, _: web.Request) -> web.Response:
        return web.json_response(
            {
                "on": self._camera_on,
                "idle_close_s": self._idle_close_s,
                "last_use_age_s": (time.time() - self._last_use)
                if self._last_use
                else None,
            }
        )

    async def status_handler(self, _: web.Request) -> web.Response:
        info = self.camera.info if self._camera_on else None
        snap = self.memory.latest()
        return web.json_response(
            {
                "camera_on": self._camera_on,
                "camera": {
                    "index": info.index,
                    "width": info.width,
                    "height": info.height,
                    "fps": info.fps,
                }
                if info
                else None,
                "analyzer_ready": self.analyzer is not None,
                "last_capture_age_s": (time.time() - snap.ts) if snap else None,
                "memory_size": len(self.memory._snapshots),  # noqa: SLF001
            }
        )

    async def request_handler(self, request: web.Request) -> web.Response:
        body = await request.json()
        result = await self.handle_vision_request(
            body.get("query") or "Bu görselde ne var?"
        )
        return web.json_response(result)

    async def run(self) -> None:
        # NOTE: camera is intentionally NOT started here. It opens only on
        # /camera/on, /capture, or VISION_TRIGGERED, and auto-closes after idle.
        logger.info("[service] camera idle — open via /camera/on or /capture")

        app = web.Application()
        app.router.add_get("/stream", self.mjpeg_handler)
        app.router.add_get("/status", self.status_handler)
        app.router.add_post("/capture", self.request_handler)
        app.router.add_post("/camera/on", self.camera_on_handler)
        app.router.add_post("/camera/off", self.camera_off_handler)
        app.router.add_get("/camera/state", self.camera_state_handler)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", MJPEG_PORT)
        await site.start()
        logger.info(f"[http] listening on http://localhost:{MJPEG_PORT}")

        bus_task = asyncio.create_task(self.bus_loop())
        self._idle_task = asyncio.create_task(self._idle_loop())
        await self._stop.wait()
        bus_task.cancel()
        if self._idle_task:
            self._idle_task.cancel()
        await runner.cleanup()
        if self._camera_on:
            self.camera.stop()


async def main() -> None:
    load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")
    service = VisionService()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, service._stop.set)
    await service.run()


if __name__ == "__main__":
    asyncio.run(main())
