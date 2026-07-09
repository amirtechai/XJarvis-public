"""XJarvis ReAct agent loop — streaming chunks + tool execution."""

from __future__ import annotations

import json
import os
import time
from typing import AsyncIterator

from loguru import logger

# Message history window size (keep system prompt + recent N messages)
# Prevents unbounded growth in long conversations while preserving context
AGENT_HISTORY_MAX = int(os.getenv("AGENT_HISTORY_MAX", "24"))

from .config import AgentConfig
from .llm.ollama import OllamaClient
from .llm.openrouter import LLMClient, merge_tool_call_deltas
from .memory import approvals as _approvals
from .memory import rate_limit as _rate_limit
from .memory import recorder as _recorder
from .memory.store import (
    all_facts,
    attach_tool_calls,
    daily_spend_usd,
    record_cost,
    record_episode,
    record_latency,
    record_tool_call,
    recent_episodes,
    search_episodes,
)
from .tools import registry

SYSTEM_PROMPT = """Sen XJarvis — Patron'un macOS asistanı. Türkçe konuş, hitap SADECE "Patron".
Yasak: "Fatih", "efendim", "sir", "kardeşim", "tabii ki", "kesinlikle".
Stil: çok kısa, net, dalkavukluk yok. Sözlü cevap max 25 kelime.

KURAL: eylem isteniyorsa MUTLAKA uygun tool'u çağır. "Tamam patron" deyip durma —
tool call zincirini bitir.

İpuçları:
- XJarvis İÇİ sayfa/sekme (multi-tv, tv duvarı, haberler, trading, dashboard,
  orbital hud, notion, agents, tools, brief, kgraph, research, design, inbox,
  takvim, goals, podcast, whiteboard...) → MUTLAKA xjarvis_page tool.
  ⚠️ Bunlar için ASLA open_app/browser_open/Safari KULLANMA — bunlar XJarvis'in
  kendi sekmeleri, harici site/uygulama DEĞİL.
- Harici macOS uygulaması (Safari, Spotify, Hesap Makinesi, Notlar) → open_app
- Harici web sitesi (google.com, bir URL) → browser_open
- macOS shell → shell_exec
- Web bilgisi → web_search
- Görsel iş → computer_use(goal="…")
- Hatırlatıcı/not → shell_exec POST localhost:3001/api/quick-capture
- Sistem kontrol (mic/camera/volume) → shell_exec POST localhost:3001/api/control/*
- Kalıcı kişisel bilgi → fact_remember(key,value)
- "Anlamadım/üzgünüm/yapamam" YASAK — net eylem yap veya net soru sor."""


def _model_label(model: str) -> str:
    """Ham model id → konuşma dilinde okunur etiket (kimlik sorularında kullanılır)."""
    m = (model or "").lower()
    table = [
        ("claude-opus-4-8", "Claude Opus 4.8 (Anthropic)"),
        ("claude-opus", "Claude Opus (Anthropic)"),
        ("claude-sonnet-5", "Claude Sonnet 5 (Anthropic)"),
        ("claude-sonnet-4-6", "Claude Sonnet 4.6 (Anthropic)"),
        ("claude-sonnet", "Claude Sonnet (Anthropic)"),
        ("claude-haiku", "Claude Haiku 4.5 (Anthropic)"),
        ("claude", "Claude (Anthropic)"),
        ("gemini", "Gemini Flash (Google)"),
        ("llama", "Llama (Meta)"),
        ("qwen", "Qwen"),
        ("deepseek", "DeepSeek"),
        ("gpt-oss", "yerel GPT-OSS (Ollama)"),
    ]
    for key, label in table:
        if key in m:
            return label
    return model or "bilinmeyen"


def _identity_directive(model: str) -> str:
    return (
        f"KİMLİK: Adın XJarvis. Çalıştığın yapay zekâ modeli: {_model_label(model)}. "
        f"Biri 'modelin ne / hangi LLM / hangi yapay zekâsın' diye sorarsa SADECE bu "
        f"bilgiyi söyle — başka model adı (özellikle Gemini'yi varsayılan sanma) uydurma."
    )


def _build_memory_context(user_query: str) -> str:
    parts: list[str] = []

    # Anlık zaman/yer bağlamı — "saat kaç", "bugün ne", "günlerden ne" gibi
    # sorularda tool çağırmadan doğrudan cevaplaması için.
    from datetime import datetime
    import time as _time

    now = datetime.now()
    tz_name = _time.strftime("%Z") or "yerel"
    days_tr = [
        "Pazartesi",
        "Salı",
        "Çarşamba",
        "Perşembe",
        "Cuma",
        "Cumartesi",
        "Pazar",
    ]
    months_tr = [
        "Ocak",
        "Şubat",
        "Mart",
        "Nisan",
        "Mayıs",
        "Haziran",
        "Temmuz",
        "Ağustos",
        "Eylül",
        "Ekim",
        "Kasım",
        "Aralık",
    ]
    parts.append(
        f"Şu anki zaman ve tarih (kullanıcı sorduğunda tool ÇAĞIRMA, doğrudan söyle):\n"
        f"- Saat: {now.strftime('%H:%M')} ({tz_name})\n"
        f"- Tarih: {now.day} {months_tr[now.month - 1]} {now.year}, {days_tr[now.weekday()]}"
    )

    facts = all_facts()
    if facts:
        fact_lines = [f"- {k}: {v}" for k, v in list(facts.items())[:30]]
        parts.append(
            "Kullanıcı hakkında bildiklerin (kalıcı):\n" + "\n".join(fact_lines)
        )

    recent = recent_episodes(limit=5)
    if recent:
        rec_lines = []
        for e in recent:
            q = (e["query"] or "").strip().replace("\n", " ")[:120]
            r = (e["response"] or "").strip().replace("\n", " ")[:160]
            if q:
                rec_lines.append(f"- Q: {q}\n  A: {r}")
        if rec_lines:
            parts.append("Son konuşmalar (kronolojik):\n" + "\n".join(rec_lines))

    relevant = search_episodes(user_query, limit=3)
    rel_filtered = [e for e in relevant if e not in recent]
    if rel_filtered:
        rel_lines = []
        for e in rel_filtered:
            q = (e["query"] or "").strip().replace("\n", " ")[:120]
            r = (e["response"] or "").strip().replace("\n", " ")[:160]
            if q:
                rel_lines.append(f"- Q: {q}\n  A: {r}")
        if rel_lines:
            parts.append("Bu konuyla ilgili geçmiş kayıtlar:\n" + "\n".join(rel_lines))

    if not parts:
        return ""
    return (
        "## Hafıza Bağlamı\n"
        "Aşağıdaki bilgileri kullanıcıyla konuşurken hatırla. Sadece "
        "alakalıysa referans ver, gereksiz yere okuma.\n\n" + "\n\n".join(parts)
    )


def _prune_message_history(
    messages: list[dict], max_messages: int = AGENT_HISTORY_MAX
) -> list[dict]:
    """Keep system messages + recent N messages, respecting tool_call/tool_result pairs.

    Ensures assistant-tool_call messages stay paired with their tool_result responses.
    Removes oldest messages first while maintaining pair integrity.
    """
    if len(messages) <= max_messages:
        return messages

    # Find system messages (always keep)
    system_idxs = [i for i, m in enumerate(messages) if m.get("role") == "system"]
    if not system_idxs:
        return messages

    # Last system message index
    last_system_idx = max(system_idxs)
    system_msgs = messages[: last_system_idx + 1]

    # Messages after system
    remaining = messages[last_system_idx + 1 :]

    # How many messages we can keep after system
    budget = max_messages - len(system_msgs)
    if budget <= 0:
        return system_msgs

    if len(remaining) <= budget:
        return system_msgs + remaining

    # Trim from oldest, respecting pairs (assistant + tool_results)
    # Walk backwards to identify tool_result messages
    pairs_end_idx = []
    i = len(remaining) - 1
    kept_count = 0

    while i >= 0 and kept_count < budget:
        msg = remaining[i]
        if msg.get("role") == "tool":
            # Find matching assistant message (scan back)
            call_id = msg.get("tool_call_id")
            j = i - 1
            while j >= 0:
                if remaining[j].get("role") == "assistant" and call_id in [
                    tc.get("id") for tc in remaining[j].get("tool_calls", [])
                ]:
                    # Found pair: [j] = assistant, [i] = tool_result
                    pairs_end_idx.append(j)
                    kept_count += 2
                    i = j - 1
                    break
                j -= 1
            else:
                # No matching assistant — keep tool message alone
                pairs_end_idx.append(i)
                kept_count += 1
                i -= 1
        else:
            # Non-tool message — keep it
            pairs_end_idx.append(i)
            kept_count += 1
            i -= 1

        if kept_count >= budget:
            break

    # Sort kept indices and slice
    if not pairs_end_idx:
        return system_msgs

    pairs_end_idx.sort()
    start_idx = min(pairs_end_idx) if pairs_end_idx else len(remaining)
    trimmed = remaining[start_idx:]

    return system_msgs + trimmed


class AgentLoop:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self.client = LLMClient(
            api_key=config.api_key,
            site_url=config.site_url,
            app_name=config.app_name,
            endpoint_url=config.endpoint_url,
        )
        self.ollama = OllamaClient()
        self.tool_specs = registry.all_specs()
        self._claude = None
        if config.provider == "claude":
            from .llm.claude_sdk import ClaudeSdkRunner

            self._claude = ClaudeSdkRunner(config)

    async def aclose(self) -> None:
        await self.client.aclose()
        await self.ollama.aclose()

    async def run(
        self, user_query: str, model: str | None = None, record: bool = True
    ) -> AsyncIterator[dict]:
        """Yield events: {type: 'text', content} | {type: 'tool_start', name, args}
        | {type: 'tool_end', name, result} | {type: 'done'} | {type: 'error', message}

        record=False → episode/latency hafizaya YAZILMAZ (prewarm/ping icin)."""
        # Rate limit — per-minute/per-hour query cap
        allowed, reason = _rate_limit.check()
        if not allowed:
            yield {"type": "error", "message": reason}
            return

        # Cost guard — gün içinde cap aşıldıysa local Ollama'ya bilgi mesajı (şimdilik uyarı)
        spent = daily_spend_usd()
        if spent >= self.config.daily_cap_usd:
            yield {
                "type": "text",
                "content": f"[Bugünkü API harcaması ${spent:.3f} cap'i aştı; ucuz moda geçiliyor.] ",
            }
            chosen_model = self.config.model_free
        else:
            chosen_model = model or self.config.model_default

        memory_context = _build_memory_context(user_query)
        # Tek ve net dil/hitap direktifi — sistem prompt'la çelişmesin.
        lang_directive = (
            "Kullanıcının diliyle cevap ver (Türkçe gelirse Türkçe, English gelirse English). "
            "Hitap: SADECE 'Patron'. Cevap kısa ve direkt. "
            "İstek bir eylem gerektiriyorsa MUTLAKA uygun tool'u çağır — sadece 'tamam' "
            "demek yetmez. Önce kısa onay metni, sonra tool call, sonra sonuç."
        )
        identity = _identity_directive(chosen_model)
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "system", "content": identity},
            {"role": "system", "content": lang_directive},
        ]
        if memory_context:
            messages.append({"role": "system", "content": memory_context})
        messages.append({"role": "user", "content": user_query})

        # Claude aboneligi (Agent SDK) yolu — ReAct loop yerine SDK kendi dongusunu kosar.
        if self._claude is not None:
            full_system = (
                SYSTEM_PROMPT
                + "\n\n"
                + identity
                + "\n\n"
                + lang_directive
                + (("\n\n" + memory_context) if memory_context else "")
            )
            async for _ev in self._claude.run(
                user_query, model=chosen_model, system_extra=full_system, record=record
            ):
                yield _ev
            return

        started = time.time()
        first_token_at: float | None = None
        full_response = ""
        tools_used: list[str] = []
        call_ids: list[int] = []
        _seen_calls: dict[str, int] = {}  # (name+args) → tekrar sayısı (döngü guard)
        logger.info(f"[loop] QUERY: {user_query!r}  model={chosen_model}")

        for iteration in range(self.config.max_iter):
            text_buf = ""
            raw_tool_chunks: list = []

            # Bounded message history: keep system prompt + recent N messages
            # Prevents unbounded token growth in long conversations
            messages = _prune_message_history(messages, AGENT_HISTORY_MAX)

            # Try OpenRouter; on network failure fall back to local Ollama
            stream = self.client.stream_chat(
                messages=messages,
                model=chosen_model,
                tools=self.tool_specs,
                query=user_query,
            )
            using_fallback = False
            try:
                first = await stream.__anext__()
            except StopAsyncIteration:
                first = None
            except (RuntimeError, Exception) as e:  # noqa: BLE001
                # Classify error FIRST before logging full traceback
                msg_l = str(e).lower()
                netfail = any(
                    k in msg_l
                    for k in (
                        "together",
                        "openrouter",
                        "connect",
                        "timeout",
                        "connection",
                        "name resolution",
                        "network",
                        "unreachable",
                    )
                )

                # Log once with classification + traceback
                import traceback as _tb

                logger.error(
                    f"[loop] first-token error iter={iteration} "
                    f"(netfail={netfail}): {type(e).__name__}: {e!r}\n{_tb.format_exc()}"
                )
                if not netfail or not await self.ollama.is_up():
                    await stream.aclose()
                    yield {"type": "error", "message": f"{type(e).__name__}: {e}"}
                    return
                using_fallback = True
                yield {
                    "type": "text",
                    "content": "[İnternet yok — yerel Ollama'ya geçildi.] ",
                }
                await stream.aclose()
                stream = self.ollama.stream_chat(
                    messages=messages,
                    model=None,
                    tools=self.tool_specs,
                    query=user_query,
                )
                try:
                    first = await stream.__anext__()
                except StopAsyncIteration:
                    first = None
                except Exception as e2:  # noqa: BLE001
                    await stream.aclose()
                    yield {"type": "error", "message": f"Ollama also failed: {e2}"}
                    return

            try:

                async def _replay():
                    if first is not None:
                        yield first
                    async for d in stream:
                        yield d

                async for delta in _replay():
                    if "_usage" in delta:
                        u = delta["_usage"]
                        cost = float(u.get("cost") or 0.0)
                        record_cost(
                            chosen_model,
                            int(u.get("prompt_tokens") or 0),
                            int(u.get("completion_tokens") or 0),
                            cost,
                        )
                        continue
                    content = delta.get("content")
                    if content:
                        if first_token_at is None:
                            first_token_at = time.time()
                        text_buf += content
                        full_response += content
                        yield {"type": "text", "content": content}
                    tcs = delta.get("tool_calls")
                    if tcs:
                        raw_tool_chunks.extend(tcs)
            except Exception as e:
                import traceback as _tb

                logger.error(
                    f"[loop] stream error iter={iteration}: {type(e).__name__}: {e}\n{_tb.format_exc()}"
                )
                yield {
                    "type": "error",
                    "message": f"{type(e).__name__}: {e}" or repr(e),
                }
                return

            tool_calls = merge_tool_call_deltas(raw_tool_chunks)

            if not tool_calls:
                total_ms = int((time.time() - started) * 1000)
                ttft_ms = (
                    int((first_token_at - started) * 1000) if first_token_at else None
                )
                episode_id = record_episode(
                    user_query, full_response, tools_used, total_ms
                )
                attach_tool_calls(call_ids, episode_id)
                record_latency(chosen_model, total_ms, ttft_ms, len(tools_used))
                yield {
                    "type": "latency",
                    "total_ms": total_ms,
                    "ttft_ms": ttft_ms,
                    "tool_count": len(tools_used),
                    "model": chosen_model,
                }
                yield {"type": "done"}
                return

            assistant_msg: dict = {"role": "assistant", "content": text_buf or None}
            assistant_msg["tool_calls"] = [
                {
                    "id": tc["id"] or f"call_{i}",
                    "type": "function",
                    "function": {
                        "name": tc["name"],
                        "arguments": tc["arguments"] or "{}",
                    },
                }
                for i, tc in enumerate(tool_calls)
            ]
            messages.append(assistant_msg)

            for i, tc in enumerate(tool_calls):
                call_id = tc["id"] or f"call_{i}"
                name = tc["name"]
                args_raw = tc["arguments"] or "{}"
                try:
                    args = json.loads(args_raw)
                except json.JSONDecodeError:
                    args = {}

                # Döngü guard: aynı tool+args 2. kez geldiyse çalıştırma, modele
                # "zaten yaptın, FARKLI tool çağır ya da kısa cevap ver" de.
                # (Llama-3.3-70B bazen xjarvis_page_list'i üst üste çağırıp
                #  takılıyordu.)
                _key = name + "|" + json.dumps(args, sort_keys=True, ensure_ascii=False)
                _seen_calls[_key] = _seen_calls.get(_key, 0) + 1
                if _seen_calls[_key] >= 2:
                    result = (
                        f"NOT: '{name}' aynı argümanlarla zaten çağrıldı. Tekrar "
                        f"çağırma. Kullanıcının asıl isteğini yerine getirmek için "
                        f"FARKLI bir tool kullan ya da kısa bir cevap ver."
                    )
                    yield {"type": "tool_start", "name": name, "args": args}
                    yield {"type": "tool_end", "name": name, "result": result}
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call_id,
                            "name": name,
                            "content": result,
                        }
                    )
                    continue

                tools_used.append(name)
                yield {"type": "tool_start", "name": name, "args": args}

                if _approvals.needs_approval(name, args):
                    yield {"type": "approval_pending", "name": name, "args": args}
                    decision = await _approvals.request(name, args)
                    if decision != "approved":
                        result = f"BLOCKED: action {decision} by user (or timed out)"
                        yield {"type": "tool_end", "name": name, "result": result}
                        _recorder.log(name, args, result)
                        call_ids.append(record_tool_call(name, args, result))
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call_id,
                                "name": name,
                                "content": result,
                            }
                        )
                        continue

                result = await registry.execute(name, args)
                logger.info(f"[loop] TOOL {name} args={args} → {str(result)[:120]!r}")
                _recorder.log(name, args, result)
                call_ids.append(record_tool_call(name, args, result))
                result_truncated = result[:500]
                yield {"type": "tool_end", "name": name, "result": result_truncated}

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": name,
                        "content": result_truncated,
                    }
                )

        total_ms = int((time.time() - started) * 1000)
        ttft_ms = int((first_token_at - started) * 1000) if first_token_at else None
        episode_id = record_episode(user_query, full_response, tools_used, total_ms)
        attach_tool_calls(call_ids, episode_id)
        yield {
            "type": "latency",
            "total_ms": total_ms,
            "ttft_ms": ttft_ms,
            "tool_count": len(tools_used),
            "model": chosen_model,
        }
        yield {"type": "done"}
