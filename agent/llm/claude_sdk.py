"""Claude (abonelik / Agent SDK) runner — XJarvis beynini abonelik kredisiyle + ust modelle kosturur.

ReAct loop yerine claude_agent_sdk.query() kullanir; mevcut tool registry'si (102 tool)
in-process MCP'ye sarilir. Approval gate (memory.approvals) `can_use_tool` ile KORUNUR.
AgentLoop.run ile AYNI event sozlesmesini yield eder:
  {type:text|tool_start|tool_end|approval_pending|latency|done|error}
"""

from __future__ import annotations

import asyncio
import time
from typing import AsyncIterator

from loguru import logger
import claude_agent_sdk as sdk

from ..tools import registry
from ..memory import approvals as _approvals
from ..memory import recorder as _recorder
from ..memory.store import (
    record_tool_call,
    record_episode,
    record_latency,
    attach_tool_calls,
)

MCP_NAME = "xjarvis"
_PREFIX = f"mcp__{MCP_NAME}__"
_BUILTINS = [
    "Bash",
    "Edit",
    "Write",
    "Read",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "Task",
    "TodoWrite",
    "NotebookEdit",
    "BashOutput",
    "KillShell",
    "ExitPlanMode",
]


def _bare(name: str) -> str:
    return name[len(_PREFIX) :] if name.startswith(_PREFIX) else name


# Abonelik oturum/kullanim limiti + hata metinleri — gercek asistan yaniti DEGIL;
# hafizaya episode olarak kaydedilirse sonraki turlara sahte baglam olarak sizar.
_LIMIT_MARKERS = (
    "session limit",
    "usage limit",
    "rate limit",
    "you've hit your",
    "youve hit your",
    "claude usage limit",
    "quota",
)


def _looks_like_limit(text: str) -> bool:
    low = (text or "").lower()
    if any(mk in low for mk in _LIMIT_MARKERS):
        return True
    # "...limit ... resets 3pm" kalibi
    return "limit" in low and ("reset" in low or "try again" in low)


def _result_is_error(m) -> bool:
    """ResultMessage hata mi? SDK surumune dayaniksiz — getattr ile."""
    if getattr(m, "api_error_status", None):
        return True
    errs = getattr(m, "errors", None)
    if errs:
        return True
    subtype = getattr(m, "subtype", "") or ""
    if isinstance(subtype, str) and "error" in subtype.lower():
        return True
    return bool(getattr(m, "is_error", False))


CORE_SYSTEM = "Sen XJarvis — Patron'un asistanisin. Turkce, kisa, net."


class ClaudeSdkRunner:
    """AgentLoop ile ayni .run() arayuzu; abonelik + secili Claude modeli.

    KALICI OTURUM: ClaudeSDKClient bir kez connect edilir (subprocess + MCP
    yuklemesi ~10s SADECE ilk seferde); sonraki her sorgu ayni oturuma gider
    (~2-3s). Eskiden sdk.query() her cagride sifirdan baslatip akiciligi
    olduruyordu. Degisken baglam (memory/identity) sorgu metnine eklenir.
    """

    def __init__(self, config) -> None:
        self.config = config
        # LAZY: MCP tool'lari registry'ye asenkron/gec yuklendigi icin server'i
        # burada (MCP'den ONCE) kurmak MCP tool'larini kalici gorunmez birakiyordu.
        # Ilk _ensure_client()'ta (prewarm, MCP start_all'dan SONRA) build edilir.
        self._server = None
        self._client: sdk.ClaudeSDKClient | None = None
        self._client_model: str | None = None
        self._lock = asyncio.Lock()
        self._active_q: asyncio.Queue | None = None
        # Aktif sorgunun MCP tool cagrilari (episode'a baglamak icin) — produce basinda sifirlanir.
        self._pending_call_ids: list[int] = []

    def _build_server(self):
        """registry'deki her tool'u SDK MCP tool'una sarar (impl'ler degismez).

        Tool cagrisinin store id'sini `self._pending_call_ids`'e ekler ki tur
        bitince attach_tool_calls ile episode'a baglanabilsin.
        """
        tools = []
        for tname in registry.names():
            spec = registry.get(tname)
            if spec is None:
                continue
            schema = (
                spec.parameters
                if isinstance(spec.parameters, dict)
                else {"type": "object", "properties": {}}
            )

            def make_handler(tool_name):
                async def handler(args):
                    result = await registry.execute(tool_name, args or {})
                    try:
                        _recorder.log(tool_name, args or {}, result)
                    except Exception:
                        pass
                    try:
                        cid = record_tool_call(tool_name, args or {}, str(result))
                        if cid is not None:
                            self._pending_call_ids.append(cid)
                    except Exception:
                        pass
                    return {"content": [{"type": "text", "text": str(result)[:4000]}]}

                return handler

            _decorator = sdk.tool(tname, (spec.description or tname)[:1024], schema)
            tools.append(_decorator(make_handler(tname)))
        return sdk.create_sdk_mcp_server(name=MCP_NAME, version="1.0.0", tools=tools)

    def refresh_tools(self) -> None:
        """Registry degisince (yeni MCP/skill) server snapshot'ini gecersiz kil."""
        self._server = None

    async def aclose(self) -> None:
        if self._client is not None:
            try:
                await self._client.disconnect()
            except Exception:
                pass
            self._client = None

    async def _can_use_tool(self, tool_name, input_data, context):
        bare = _bare(tool_name)
        try:
            if _approvals.needs_approval(bare, input_data or {}):
                if self._active_q:
                    await self._active_q.put(
                        {
                            "type": "approval_pending",
                            "name": bare,
                            "args": input_data or {},
                        }
                    )
                decision = await _approvals.request(bare, input_data or {})
                if decision != "approved":
                    return sdk.PermissionResultDeny(
                        message=f"BLOCKED: {decision} by user"
                    )
        except Exception as e:
            logger.error(f"[claude_sdk] approval error: {e}")
        return sdk.PermissionResultAllow()

    async def _ensure_client(self, model: str) -> "sdk.ClaudeSDKClient":
        # Model degisirse oturumu yeniden kur (system_prompt/model sabit baglanir).
        if self._client is not None and self._client_model != model:
            await self.aclose()
        if self._server is None:
            # MCP tool'lari artik registry'de (start_all bitti) → tam snapshot.
            self._server = self._build_server()
        if self._client is None:
            opts = sdk.ClaudeAgentOptions(
                model=model,
                system_prompt=CORE_SYSTEM,
                mcp_servers={MCP_NAME: self._server},
                allowed_tools=[],
                disallowed_tools=_BUILTINS,
                can_use_tool=self._can_use_tool,
                permission_mode="default",
                strict_mcp_config=True,
                setting_sources=[],
                max_turns=max(self.config.max_iter, 12),
            )
            client = sdk.ClaudeSDKClient(options=opts)
            await client.connect()
            self._client = client
            self._client_model = model
            logger.info(f"[claude_sdk] kalici oturum acildi (model={model})")
        return self._client

    async def run(
        self,
        user_query: str,
        model: str | None = None,
        system_extra: str = "",
        record: bool = True,
    ) -> AsyncIterator[dict]:
        chosen_model = model or self.config.model_default
        # Degisken baglam (kimlik + memory + dil direktifi) sorgu metnine eklenir;
        # sabit CORE_SYSTEM oturuma baglidir.
        extra = system_extra.strip()
        prompt_text = (
            f"[BAĞLAM]\n{extra}\n[/BAĞLAM]\n\n{user_query}" if extra else user_query
        )

        q: asyncio.Queue = asyncio.Queue()
        id_to_name: dict[str, str] = {}
        started = time.time()
        first_at: float | None = None
        tools_used: list[str] = []
        full_response = ""

        async def produce():
            try:
                async with self._lock:  # tek oturum → sorgular seri
                    client = await self._ensure_client(chosen_model)
                    self._active_q = q
                    self._pending_call_ids = []
                    await client.query(prompt_text)
                    async for m in client.receive_response():
                        if isinstance(m, sdk.AssistantMessage):
                            for b in m.content:
                                if isinstance(b, sdk.TextBlock) and b.text:
                                    await q.put({"type": "text", "content": b.text})
                                elif isinstance(b, sdk.ToolUseBlock):
                                    bare = _bare(b.name)
                                    id_to_name[b.id] = bare
                                    await q.put(
                                        {
                                            "type": "tool_start",
                                            "name": bare,
                                            "args": b.input or {},
                                        }
                                    )
                        elif isinstance(m, sdk.UserMessage):
                            content = m.content if isinstance(m.content, list) else []
                            for b in content:
                                if isinstance(b, sdk.ToolResultBlock):
                                    nm = id_to_name.get(
                                        getattr(b, "tool_use_id", ""), ""
                                    )
                                    raw = b.content
                                    if isinstance(raw, list):
                                        parts = []
                                        for x in raw:
                                            if isinstance(x, dict):
                                                parts.append(x.get("text", "") or "")
                                            elif hasattr(x, "text"):
                                                parts.append(
                                                    getattr(x, "text", "") or ""
                                                )
                                            else:
                                                parts.append(str(x))
                                        txt = "".join(parts)
                                    else:
                                        txt = raw if isinstance(raw, str) else str(raw)
                                    await q.put(
                                        {
                                            "type": "tool_end",
                                            "name": nm,
                                            "result": str(txt)[:500],
                                        }
                                    )
                        elif isinstance(m, sdk.ResultMessage):
                            await q.put({"_result": m})
            except Exception as e:
                import traceback

                logger.error(f"[claude_sdk] query error: {e}\n{traceback.format_exc()}")
                # Bozuk oturumu at → sonraki sorgu temiz reconnect etsin.
                await self.aclose()
                await q.put({"type": "error", "message": f"{type(e).__name__}: {e}"})
            finally:
                self._active_q = None
            await q.put({"__done__": True})

        task = asyncio.create_task(produce())
        try:
            while True:
                ev = await q.get()
                if "__done__" in ev:
                    break
                if "_result" in ev:
                    total_ms = int((time.time() - started) * 1000)
                    ttft_ms = int((first_at - started) * 1000) if first_at else None
                    # Hata/limit yanitini GERCEK asistan turu gibi kaydetme —
                    # yoksa "You've hit your session limit..." sonraki turlara
                    # sahte konusma gecmisi olarak enjekte oluyor.
                    is_err = _result_is_error(ev["_result"]) or _looks_like_limit(
                        full_response
                    )
                    if record and not is_err:
                        try:
                            episode_id = record_episode(
                                user_query, full_response, tools_used, total_ms
                            )
                            if episode_id is not None and self._pending_call_ids:
                                attach_tool_calls(self._pending_call_ids, episode_id)
                            record_latency(
                                chosen_model, total_ms, ttft_ms, len(tools_used)
                            )
                        except Exception:
                            pass
                    if is_err:
                        logger.warning(
                            "[claude_sdk] hata/limit yaniti — episode KAYDEDILMEDI"
                        )
                    yield {
                        "type": "latency",
                        "total_ms": total_ms,
                        "ttft_ms": ttft_ms,
                        "tool_count": len(tools_used),
                        "model": chosen_model,
                    }
                    continue
                t = ev.get("type")
                if t == "text":
                    if first_at is None:
                        first_at = time.time()
                    full_response += ev["content"]
                elif t == "tool_start":
                    tools_used.append(ev["name"])
                yield ev
        finally:
            if not task.done():
                # Tuketici turu yarida birakti (client disconnect / erken kapanis) →
                # yarim receive_response oturumu kirletir; iptal et + oturumu at ki
                # sonraki sorgu temiz reconnect etsin (paylasilan _client bozulmasin).
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
                await self.aclose()
        yield {"type": "done"}
