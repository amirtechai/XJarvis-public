"""Ollama local LLM fallback client.

OpenAI-compatible streaming via /api/chat. Used when OpenRouter is unreachable.
Tool-calling support depends on the model — Ollama 0.4+ supports it for
qwen2.5, llama3.2, etc. Fallback gracefully if the model lacks tools.
"""

from __future__ import annotations

import json
import os
from typing import AsyncIterator, Iterable

import httpx

OLLAMA_BASE = os.getenv("OLLAMA_BASE", "http://localhost:11434")
OLLAMA_DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:latest")


class OllamaClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=3.0))

    async def aclose(self) -> None:
        await self._client.aclose()

    async def is_up(self) -> bool:
        try:
            r = await self._client.get(f"{OLLAMA_BASE}/api/tags", timeout=2.0)
            return r.status_code == 200
        except httpx.HTTPError:
            return False

    async def stream_chat(
        self,
        messages: list[dict],
        model: str | None = None,
        tools: list[dict] | None = None,
        temperature: float = 0.7,
        query: str | None = None,
    ) -> AsyncIterator[dict]:
        """Yield delta-shaped events compatible with OpenRouterClient.

        query: optional parameter for compatibility with LLMClient (unused).
        """
        chosen = model or OLLAMA_DEFAULT_MODEL
        # Ollama wants OpenAI-style messages; map content blocks (image_url) to text-only
        clean_messages = []
        for m in messages:
            content = m.get("content")
            if isinstance(content, list):
                texts = [b.get("text", "") for b in content if b.get("type") == "text"]
                clean_messages.append({**m, "content": "\n".join(texts)})
            else:
                clean_messages.append(m)

        payload = {
            "model": chosen,
            "messages": clean_messages,
            "stream": True,
            "options": {"temperature": temperature},
        }
        if tools:
            payload["tools"] = tools

        try:
            async with self._client.stream(
                "POST",
                f"{OLLAMA_BASE}/api/chat",
                json=payload,
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise RuntimeError(
                        f"Ollama {resp.status_code}: {body.decode()[:300]}"
                    )

                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    msg = chunk.get("message") or {}
                    content = msg.get("content")
                    tool_calls = msg.get("tool_calls")
                    delta: dict = {}
                    if content:
                        delta["content"] = content
                    if tool_calls:
                        # Convert Ollama format → OpenAI streaming format
                        delta["tool_calls"] = [
                            {
                                "index": i,
                                "id": tc.get("id", "") or f"call_{i}",
                                "function": {
                                    "name": tc.get("function", {}).get("name", ""),
                                    "arguments": json.dumps(
                                        tc.get("function", {}).get("arguments", {}),
                                        ensure_ascii=False,
                                    ),
                                },
                            }
                            for i, tc in enumerate(tool_calls)
                        ]
                    if delta:
                        yield delta
                    if chunk.get("done"):
                        usage = {
                            "prompt_tokens": int(chunk.get("prompt_eval_count") or 0),
                            "completion_tokens": int(chunk.get("eval_count") or 0),
                            "cost": 0.0,  # local = free
                        }
                        yield {"_usage": usage}
                        break
        except httpx.HTTPError as e:
            raise RuntimeError(f"Ollama connect: {e}") from e
