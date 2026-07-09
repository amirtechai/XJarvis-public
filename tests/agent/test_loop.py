"""Agent loop tests with a mocked OpenRouter client.

Exercises the ReAct cycle: model emits a tool call → tool executes → model
emits final text → loop terminates with a `done` event.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest

from agent.config import AgentConfig
from agent.loop import AgentLoop


class FakeClient:
    """Stub OpenRouter client — yields scripted deltas per call."""

    def __init__(self, scripts: list[list[dict]]) -> None:
        self._scripts = list(scripts)
        self.calls: list[dict] = []

    async def aclose(self) -> None:
        pass

    async def stream_chat(self, messages, model, tools=None, temperature=0.7, **kwargs):
        # **kwargs: gerçek LLMClient smart-tool seçimi için query= vb. ekledi.
        self.calls.append({"messages": messages, "model": model, "tools": tools})
        deltas = self._scripts.pop(0)
        for d in deltas:
            yield d


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("LLM_DAILY_CAP_USD", "100")
    return AgentConfig.load()


def collect(gen):
    async def _run():
        out = []
        async for ev in gen:
            out.append(ev)
        return out

    return asyncio.run(_run())


def test_no_tool_calls_terminates(cfg):
    """Model returns plain text → loop emits text + latency + done."""
    loop = AgentLoop(cfg)
    loop._claude = None  # SDK yolu değil ReAct/FakeClient yolunu test et (deterministik, kota yakmaz)
    loop.client = FakeClient(
        [
            [{"content": "Merhaba"}, {"content": " efendim."}],
        ]
    )
    events = collect(loop.run("selam"))
    types = [e["type"] for e in events]
    assert "text" in types
    assert types[-1] == "done"
    assert types[-2] == "latency"
    text = "".join(e["content"] for e in events if e["type"] == "text")
    assert text == "Merhaba efendim."


def test_tool_call_then_final_response(cfg):
    """Model → tool call → tool exec → model again → final text."""
    loop = AgentLoop(cfg)
    loop._claude = None
    loop.client = FakeClient(
        [
            # Iteration 1: emit tool call (no content)
            [
                {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "c1",
                            "function": {
                                "name": "shell_exec",
                                "arguments": '{"command": "echo abc"}',
                            },
                        }
                    ]
                }
            ],
            # Iteration 2: emit final text
            [{"content": "abc."}],
        ]
    )
    events = collect(loop.run("echo abc"))
    starts = [e for e in events if e["type"] == "tool_start"]
    ends = [e for e in events if e["type"] == "tool_end"]
    texts = [e for e in events if e["type"] == "text"]
    assert len(starts) == 1
    assert starts[0]["name"] == "shell_exec"
    assert len(ends) == 1
    assert "abc" in ends[0]["result"]
    assert any("abc" in t["content"] for t in texts)
    assert events[-1]["type"] == "done"


def test_max_iter_bound(cfg, monkeypatch):
    """If model keeps calling tools, loop terminates after max_iter."""
    monkeypatch.setenv("AGENT_MAX_ITER", "2")
    cfg2 = AgentConfig.load()
    loop = AgentLoop(cfg2)
    loop._claude = None
    # Each iteration: emit a tool call. After 2, loop must end.
    one = [
        {
            "tool_calls": [
                {
                    "index": 0,
                    "id": "c",
                    "function": {
                        "name": "shell_exec",
                        "arguments": '{"command":"true"}',
                    },
                }
            ]
        }
    ]
    loop.client = FakeClient([one, one])
    events = collect(loop.run("loop forever"))
    tool_calls = [e for e in events if e["type"] == "tool_start"]
    assert len(tool_calls) == 2
    assert events[-1]["type"] == "done"
