"""XJarvis agent HTTP/SSE service.

Endpoints:
  GET  /health
  POST /agent/query  {"query": "...", "model": "optional"}  → SSE stream

Also connects to Node event bus (ws://localhost:3001) and emits agent events.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from aiohttp import web
import websockets


def _kill_stale_on_port(port: int) -> bool:
    """If another process is bound to `port`, identify and SIGKILL it.

    Returns True if a stale holder was killed (and we should retry binding).
    Skips killing our own PID. Used at startup to recover from zombie
    instances of agent.service that survived a previous crash."""
    try:
        out = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-Fp"],
            capture_output=True,
            text=True,
            timeout=2.0,
        )
    except Exception as e:
        print(f"[xjarvis-agent] lsof failed: {e}", flush=True)
        return False
    if out.returncode != 0 or not out.stdout.strip():
        return False
    self_pid = os.getpid()
    killed = False
    for line in out.stdout.splitlines():
        if not line.startswith("p"):
            continue
        try:
            pid = int(line[1:])
        except ValueError:
            continue
        if pid == self_pid:
            continue
        print(
            f"[xjarvis-agent] killing stale holder of port {port}: pid={pid}",
            flush=True,
        )
        try:
            os.kill(pid, signal.SIGTERM)
            for _ in range(15):  # up to 1.5s grace
                time.sleep(0.1)
                try:
                    os.kill(pid, 0)  # still alive?
                except ProcessLookupError:
                    break
            else:
                os.kill(pid, signal.SIGKILL)
            killed = True
        except ProcessLookupError:
            killed = True
        except Exception as e:
            print(f"[xjarvis-agent] kill pid={pid} failed: {e}", flush=True)
    return killed


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from agent.config import AgentConfig  # noqa: E402
from agent.loop import AgentLoop  # noqa: E402
from agent.mcp_client import MCPManager  # noqa: E402
from agent.memory import approvals as _approvals  # noqa: E402
from agent.memory import rate_limit as _rate_limit  # noqa: E402
from agent.memory.store import (  # noqa: E402
    daily_spend_usd,
    delete_all_episodes,
    episode_count,
    get_tool_call,
    latency_stats,
    recent_episodes,
    recent_latencies,
    recent_tool_calls,
    search_episodes,
)
from agent.skills_loader import register_skill_tools  # noqa: E402
from agent.tools import registry  # noqa: E402
from agent.tools import memory as _mem_tools  # noqa: E402,F401  (auto-register)

BUS_URL = "ws://localhost:3001"


class AgentService:
    def __init__(self) -> None:
        self.config = AgentConfig.load()
        register_skill_tools()
        self.mcp = MCPManager()
        self.loop = AgentLoop(self.config)
        self._stop = asyncio.Event()
        self._bus_ws = None

    async def emit_bus(self, event: str, payload: dict) -> None:
        if self._bus_ws is None:
            return
        try:
            await self._bus_ws.send(
                json.dumps(
                    {
                        "type": "bus_emit",
                        "event": event,
                        "payload": payload,
                        "source": "agent",
                    }
                )
            )
        except Exception:
            pass

    async def bus_loop(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with websockets.connect(BUS_URL) as ws:
                    self._bus_ws = ws
                    backoff = 1.0
                    await ws.send(json.dumps({"type": "subscribe", "events": []}))
                    await self.emit_bus(
                        "SERVICE_HEALTH_CHANGE", {"service": "agent", "status": "up"}
                    )
                    async for _ in ws:
                        pass
            except Exception:
                self._bus_ws = None
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=backoff)
                    return
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 1.6, 30.0)

    async def health_handler(self, _: web.Request) -> web.Response:
        return web.json_response(
            {
                "status": "up",
                "mcp_ready": getattr(self, "_mcp_ready", True),
                "model_default": self.config.model_default,
                "tools": registry.names(),
                "bus_connected": self._bus_ws is not None,
            }
        )

    async def metrics_handler(self, _: web.Request) -> web.Response:
        return web.json_response(
            {
                "spend_usd_today": daily_spend_usd(),
                "daily_cap_usd": self.config.daily_cap_usd,
                "latency_60min": latency_stats(60),
                "recent_turns": recent_latencies(20),
                "tools_count": len(registry.names()),
                "rate_limit": _rate_limit.stats(),
            }
        )

    async def vision_describe_handler(self, request: web.Request) -> web.Response:
        """Tek SDK vision yolu (abonelik kredisi). Body: {image_url|image_b64, query}.

        backend/vision-detect.js bunu çağırır — OpenRouter/Together yerine Claude.
        """
        try:
            body = await request.json()
        except Exception:
            body = {}
        query = (body.get("query") or "Bu görüntüde ne var? 2-3 cümle Türkçe.").strip()
        image_b64 = body.get("image_b64")
        image_url = body.get("image_url")

        from agent.llm.anthropic_vision import analyze_image

        try:
            if image_b64:
                import base64 as _b64

                data = _b64.b64decode(image_b64)
            elif image_url:
                import httpx

                async with httpx.AsyncClient(timeout=15.0) as c:
                    r = await c.get(image_url)
                    if r.status_code != 200:
                        return web.json_response(
                            {"ok": False, "error": f"image fetch {r.status_code}"},
                            status=502,
                        )
                    data = r.content
            else:
                return web.json_response(
                    {"ok": False, "error": "image_url veya image_b64 gerekli"},
                    status=400,
                )
            text = await analyze_image(data, query)
            ok = not text.startswith("ERROR:")
            return web.json_response(
                {"ok": ok, "text": text}, status=200 if ok else 500
            )
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    async def llm_complete_handler(self, request: web.Request) -> web.Response:
        """Tek SDK metin yolu (abonelik kredisi). Body: {prompt, system?, model?}.

        backend/llm-sdk.js bunu çağırır — eski ANTHROPIC_API_KEY yolu yerine.
        """
        try:
            body = await request.json()
        except Exception:
            body = {}
        prompt = (body.get("prompt") or "").strip()
        if not prompt:
            return web.json_response(
                {"ok": False, "error": "prompt gerekli"}, status=400
            )

        from agent.llm.claude_text import complete

        try:
            text = await complete(
                prompt,
                system=(body.get("system") or None),
                model=(body.get("model") or None),
            )
            ok = not text.startswith("ERROR:")
            return web.json_response(
                {"ok": ok, "text": text if ok else None, "error": None if ok else text},
                status=200 if ok else 500,
            )
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    async def history_handler(self, request: web.Request) -> web.Response:
        params = request.rel_url.query
        try:
            limit = int(params.get("limit", "30"))
        except ValueError:
            limit = 30
        limit = max(1, min(limit, 200))
        q = (params.get("q") or "").strip()
        eps = search_episodes(q, limit=limit) if q else recent_episodes(limit=limit)
        return web.json_response({"total": episode_count(), "episodes": eps, "q": q})

    async def history_clear_handler(self, _: web.Request) -> web.Response:
        deleted = delete_all_episodes()
        return web.json_response({"ok": True, "deleted": deleted})

    async def tool_calls_handler(self, request: web.Request) -> web.Response:
        params = request.rel_url.query
        ep = params.get("episode_id")
        try:
            limit = int(params.get("limit", "50"))
        except ValueError:
            limit = 50
        try:
            ep_id = int(ep) if ep else None
        except ValueError:
            ep_id = None
        calls = recent_tool_calls(episode_id=ep_id, limit=limit)
        return web.json_response({"calls": calls})

    async def approvals_list_handler(self, _: web.Request) -> web.Response:
        return web.json_response({"pending": _approvals.list_pending()})

    async def approvals_decide_handler(self, request: web.Request) -> web.Response:
        body = await request.json()
        rid = body.get("id")
        decision = body.get("decision")
        if not rid or decision not in ("approved", "rejected"):
            return web.json_response(
                {"ok": False, "error": "id + decision required"}, status=400
            )
        ok = _approvals.decide(rid, decision)
        return web.json_response({"ok": ok})

    async def replay_handler(self, request: web.Request) -> web.Response:
        body = await request.json()
        try:
            call_id = int(body.get("id"))
        except (TypeError, ValueError):
            return web.json_response({"ok": False, "error": "id required"}, status=400)
        rec = get_tool_call(call_id)
        if not rec:
            return web.json_response({"ok": False, "error": "not found"}, status=404)
        # Replay canli tool yolunun approval gate'ini atliyordu → eski bir yikici
        # cagriyi (shell_exec 'rm -rf', mail_send vb.) onaysiz yeniden calistirabilir.
        # Onay gerektiren cagrilarin replay'ini reddet.
        if _approvals.needs_approval(rec["name"], rec["args"] or {}):
            return web.json_response(
                {
                    "ok": False,
                    "error": "replay blocked: bu tool onay gerektiriyor "
                    "(yikici islem replay'i engellendi)",
                    "name": rec["name"],
                },
                status=403,
            )
        result = await registry.execute(rec["name"], rec["args"])
        return web.json_response(
            {
                "ok": True,
                "name": rec["name"],
                "args": rec["args"],
                "previous_result": rec["result_preview"],
                "new_result": result[:2000],
            }
        )

    @staticmethod
    def _read_text_file(path: str, max_chars: int = 40000) -> str:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                data = f.read(max_chars + 1)
            if len(data) > max_chars:
                return (
                    data[:max_chars] + f"\n…(kısaltıldı, {max_chars} karakterden uzun)"
                )
            return data
        except Exception as e:
            return f"(okunamadı: {e})"

    async def _augment_with_files(self, query: str, files: list) -> str:
        """Yüklenen dosyaları metne/analize çevirip query'e bağlam olarak ekle.
        image → Claude vision (analyze_image_file); diğerleri → metin oku+enjekte
        (pdf/docx/ses/video upload tarafında zaten .txt'ye çevrildi)."""
        parts = []
        for f in files:
            name = (f or {}).get("name") or "dosya"
            kind = (f or {}).get("kind") or "text"
            cpath = (f or {}).get("contentPath") or (f or {}).get("path")
            if not cpath or not os.path.exists(cpath):
                parts.append(f"[Ek: {name} — bulunamadı]")
                continue
            try:
                if kind == "image":
                    from agent.llm.anthropic_vision import analyze_image_file

                    q = (
                        query
                        or "Bu görseli detaylı açıkla; içindeki metin/veriyi de çıkar."
                    )
                    desc = await analyze_image_file(cpath, q)
                    parts.append(f"[Yüklenen görsel: {name}]\n{desc}")
                else:
                    text = await asyncio.to_thread(self._read_text_file, cpath, 40000)
                    parts.append(f"[Yüklenen dosya: {name}]\n{text}")
            except Exception as e:
                print(f"[upload] {name} işlenemedi: {e}", flush=True)
                parts.append(f"[Ek {name} işlenemedi: {e}]")
        if not parts:
            return query
        base = (
            query
            or "Patron bu dosyaları yükledi — içeriklerini analiz et, özetle ve istenen işi yap."
        )
        return base + "\n\n--- YÜKLENEN DOSYALAR ---\n" + "\n\n".join(parts)

    async def query_handler(self, request: web.Request) -> web.StreamResponse:
        body = await request.json()
        query = (body.get("query") or "").strip()
        files = body.get("files") or []
        model = body.get("model")
        if not query and not files:
            return web.json_response({"error": "empty query"}, status=400)
        if files:
            query = await self._augment_with_files(query, files)

        resp = web.StreamResponse(
            status=200,
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
        await resp.prepare(request)

        await self.emit_bus("QUERY_RECEIVED", {"text": query, "channel": "agent"})
        # channel=system → tts_bridge always activates playback regardless of
        # whether the request came from voice (STT) or the UI text input.
        await self.emit_bus("RESPONSE_START", {"channel": "system"})

        try:
            async for event in self.loop.run(query, model=model):
                line = f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                await resp.write(line.encode("utf-8"))
                if event["type"] == "text":
                    await self.emit_bus("RESPONSE_CHUNK", {"text": event["content"]})
                elif event["type"] == "tool_start":
                    await self.emit_bus(
                        "TOOL_CALL_START",
                        {"name": event["name"], "args": event["args"]},
                    )
                elif event["type"] == "tool_end":
                    await self.emit_bus("TOOL_CALL_END", {"name": event["name"]})
                elif event["type"] == "latency":
                    await self.emit_bus(
                        "TURN_LATENCY",
                        {
                            "total_ms": event["total_ms"],
                            "ttft_ms": event["ttft_ms"],
                            "tool_count": event["tool_count"],
                            "model": event["model"],
                        },
                    )
        finally:
            await self.emit_bus("RESPONSE_END", {})
            await resp.write_eof()
        return resp

    async def run(self) -> None:
        # ÖNCE HTTP'yi bağla, MCP'yi SONRA yükle: MCP boot'u (playwright/
        # puppeteer ~2-3dk) /health'i geciktirince Tauri watchdog'u agent'ı
        # "takıldı" sanıp boot ortasında öldürüyordu (sonsuz restart döngüsü).
        # Bind sonrası /health saniyeler içinde 200 döner; MCP araçları
        # arkada yüklenir, hazır olana dek builtin araçlarla servis verilir.
        app = web.Application()
        app.router.add_get("/health", self.health_handler)
        app.router.add_get("/metrics", self.metrics_handler)
        app.router.add_get("/history", self.history_handler)
        app.router.add_delete("/history", self.history_clear_handler)
        app.router.add_post("/agent/query", self.query_handler)
        app.router.add_post("/vision/describe", self.vision_describe_handler)
        app.router.add_post("/llm/complete", self.llm_complete_handler)
        app.router.add_get("/tool_calls", self.tool_calls_handler)
        app.router.add_post("/replay", self.replay_handler)
        app.router.add_get("/approvals", self.approvals_list_handler)
        app.router.add_post("/approvals/decide", self.approvals_decide_handler)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", self.config.port)
        # Bind with auto-recovery: if a stale agent.service is squatting the
        # port, kill it once and retry — instead of crash-looping forever.
        try:
            await site.start()
        except OSError as e:
            if e.errno != 48:  # EADDRINUSE
                raise
            print(
                f"[xjarvis-agent] port {self.config.port} busy — killing stale holder",
                flush=True,
            )
            if not _kill_stale_on_port(self.config.port):
                raise
            await asyncio.sleep(0.5)
            site = web.TCPSite(runner, "127.0.0.1", self.config.port)
            await site.start()
        print(
            f"[xjarvis-agent] listening on http://127.0.0.1:{self.config.port}",
            flush=True,
        )

        # MCP sunucularını HTTP açıldıktan sonra yükle (hatalar ölümcül değil).
        self._mcp_ready = False
        try:
            await self.mcp.start_all()
        except Exception as e:
            print(f"[xjarvis-agent] mcp init warning: {e}", flush=True)
        # MCP+skill kayıtları tamamlandı; loop'un araç listesini tazele.
        self.loop.tool_specs = registry.all_specs()
        # SDK MCP-server snapshot'ini de gecersiz kil → ilk connect'te MCP tool'lari
        # dahil tam registry ile kurulsun (yoksa MCP tool'lari SDK'ya gorunmez).
        _claude = getattr(self.loop, "_claude", None)
        if _claude is not None:
            _claude.refresh_tools()
        self._mcp_ready = True
        print(
            f"[xjarvis-agent] tools ({len(registry.names())}): {registry.names()}",
            flush=True,
        )

        # SDK kalıcı oturumunu boot'ta ısıt → ilk gerçek sorgu cold-start
        # (~10s MCP yükleme) yememesin. Bus event YOK → TTS/UI tetiklenmez.
        asyncio.create_task(self._prewarm())

        bus_task = asyncio.create_task(self.bus_loop())
        await self._stop.wait()
        bus_task.cancel()
        await self.mcp.stop_all()
        await self.loop.aclose()
        await runner.cleanup()

    async def _prewarm(self) -> None:
        """Boot'ta SDK oturumunu sessizce ısıt (ilk cevap geç gelmesin)."""
        try:
            async for _ in self.loop.run("ping", model=None, record=False):
                pass
            print("[xjarvis-agent] kalıcı oturum ısıtıldı (pre-warm)", flush=True)
        except Exception as e:
            print(f"[xjarvis-agent] pre-warm warning: {e}", flush=True)


async def main() -> None:
    service = AgentService()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, service._stop.set)
    await service.run()


if __name__ == "__main__":
    asyncio.run(main())
