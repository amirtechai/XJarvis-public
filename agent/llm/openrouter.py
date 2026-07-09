"""Provider-agnostic streaming chat client (OpenAI-compatible).

Birincil sağlayıcı Together.ai; ayrıca Groq / Gemini (OpenAI compat) — /chat/
completions sunan herhangi bir sağlayıcı. Endpoint URL construct'ta verilir.
"""

from __future__ import annotations

import json
import os
import re
from typing import AsyncIterator, Iterable

import httpx

# Default endpoint kept for legacy imports; loop.py now supplies its own.
TOGETHER_URL = "https://api.together.xyz/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
OPENROUTER_URL = TOGETHER_URL

# Tool selection config
AGENT_TOOL_LIMIT = int(os.getenv("AGENT_TOOL_LIMIT", "64"))

# Core tools that should always be available if possible
CORE_TOOLS = {
    "shell_exec",
    "open_app",
    "applescript",
    "web_search",
    "web_fetch",
    "file_read",
    "file_write",
    "notify",
    "xjarvis_page",
    "screenshot_take",
    "computer_use",
    "clipboard_read",
    "clipboard_write",
}


def _tool_meta(tool: dict) -> tuple[str, str]:
    """Tool adı+açıklamasını çıkar — hem düz {name,...} hem OpenAI
    {"type":"function","function":{name,...}} formatını destekler."""
    fn = tool.get("function") if isinstance(tool.get("function"), dict) else tool
    return (fn.get("name") or ""), (fn.get("description") or "")


def _score_tool_relevance(tool: dict, query: str) -> float:
    """Score tool relevance based on name/description keyword overlap with query.

    Uses token overlap (split on non-alphanumeric) without embeddings.
    Returns 0.0 to 1.0 relevance score.
    """
    if not query:
        return 0.0

    # Extract tokens from query (lowercase, alphanumeric only)
    query_tokens = set(re.findall(r"\w+", query.lower()))
    if not query_tokens:
        return 0.0

    # Extract tokens from tool name and description
    name, desc = _tool_meta(tool)
    tool_name = name.lower()
    tool_desc = desc.lower()
    tool_text = tool_name + " " + tool_desc

    tool_tokens = set(re.findall(r"\w+", tool_text))
    if not tool_tokens:
        return 0.0

    # Jaccard similarity: overlap / union
    overlap = len(query_tokens & tool_tokens)
    union = len(query_tokens | tool_tokens)

    return float(overlap) / union if union > 0 else 0.0


def _select_tools_smart(tools: list[dict], query: str, max_tools: int) -> list[dict]:
    """Select tools intelligently: prioritize core tools, then by relevance score.

    Ensures core tools are available, fills remaining slots by relevance ranking.
    """
    if len(tools) <= max_tools:
        return tools

    if not tools:
        return []

    # Separate core from non-core
    core_available = [t for t in tools if _tool_meta(t)[0] in CORE_TOOLS]
    non_core = [t for t in tools if _tool_meta(t)[0] not in CORE_TOOLS]

    # How many slots for non-core after reserving core
    core_count = min(len(core_available), max_tools)
    non_core_slots = max_tools - core_count

    # If we can fit all core tools, do it
    selected = core_available[:core_count]

    # Rank non-core by relevance and fill remaining slots
    if non_core_slots > 0 and non_core:
        scored = [(t, _score_tool_relevance(t, query)) for t in non_core]
        scored.sort(key=lambda x: x[1], reverse=True)
        selected.extend([t for t, _ in scored[:non_core_slots]])

    return selected


class LLMClient:
    def __init__(
        self,
        api_key: str,
        site_url: str,
        app_name: str,
        endpoint_url: str = TOGETHER_URL,
    ) -> None:
        self._url = endpoint_url
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "X-Title": app_name,
            "Content-Type": "application/json",
            # Groq sits behind Cloudflare and 403s (error 1010) requests with a
            # default python-httpx UA. A browser-like UA makes it pass.
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) xjarvis/1.0",
        }
        self._timeout = httpx.Timeout(120.0, connect=10.0)
        self._client = httpx.AsyncClient(timeout=self._timeout)

    def _ensure_client(self) -> None:
        # ReAct döngüsünün 2. turunda client bazen kapalı geliyordu
        # ("Cannot send a request, as the client has been closed"). Kapalıysa
        # yeniden oluştur — process boyunca her zaman kullanılabilir kalsın.
        if self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def stream_chat(
        self,
        messages: list[dict],
        model: str,
        tools: list[dict] | None = None,
        temperature: float = 0.7,
        query: str | None = None,
    ) -> AsyncIterator[dict]:
        """Yield streaming deltas. Each delta dict may contain 'content' or 'tool_calls'.

        query: optional user query string for smart tool relevance ranking.
        """
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "temperature": temperature,
        }
        # Stream'de token kullanımını iste (maliyet takibi için). Together /
        # Gemini / OpenAI bu OpenAI-standart bayrağı destekler.
        if any(
            h in self._url for h in ("together.xyz", "googleapis.com", "openai.com")
        ):
            payload["stream_options"] = {"include_usage": True}
        self._ensure_client()
        if tools:
            # Determine provider-specific tool limit
            if "groq.com" in self._url:
                max_tools = 32  # free tier TPM 8-30K → tight token budget
            elif "together.xyz" in self._url:
                max_tools = 64  # Llama-3.3-70B tool-calling accuracy
            elif "googleapis.com" in self._url:
                max_tools = 128
            else:
                max_tools = AGENT_TOOL_LIMIT

            # Smart tool selection: prioritize core tools, rank others by relevance
            # to user query. Prevents blind truncation from dropping critical tools.
            if len(tools) > max_tools:
                selected_tools = _select_tools_smart(tools, query or "", max_tools)
            else:
                selected_tools = tools

            payload["tools"] = selected_tools
            payload["tool_choice"] = "auto"

        async with self._client.stream(
            "POST", self._url, headers=self._headers, json=payload
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                raise RuntimeError(f"LLM {resp.status_code}: {body.decode()[:300]}")

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                if delta:
                    yield delta
                usage = chunk.get("usage")
                if usage:
                    yield {"_usage": usage}


def merge_tool_call_deltas(deltas: Iterable[dict]) -> list[dict]:
    """Aggregate streaming tool_call delta chunks by index."""
    merged: dict = {}
    for tc in deltas:
        idx = tc.get("index", 0)
        if idx not in merged:
            merged[idx] = {"id": tc.get("id", "") or "", "name": "", "arguments": ""}
        fn = tc.get("function") or {}
        if fn.get("name"):
            merged[idx]["name"] += fn["name"]
        if fn.get("arguments"):
            merged[idx]["arguments"] += fn["arguments"]
        if tc.get("id"):
            merged[idx]["id"] = tc["id"]
    return list(merged.values())
