"""Tool registry & base class — minimal, OpenAI-compatible schema."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

ToolFn = Callable[..., Awaitable[str] | str]


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict  # JSON Schema
    fn: ToolFn

    def to_openai_schema(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def all_specs(self) -> list[dict]:
        return [t.to_openai_schema() for t in self._tools.values()]

    def names(self) -> list[str]:
        return list(self._tools.keys())

    async def execute(self, name: str, arguments: dict) -> str:
        tool = self.get(name)
        if not tool:
            return f"ERROR: unknown tool '{name}'"
        # Bazı modeller argümansız tool'ları arguments=null ile çağırıyor;
        # json.loads("null") → None → tool.fn(**None) çöker. Boş dict'e indir.
        if not isinstance(arguments, dict):
            arguments = {}
        try:
            result = tool.fn(**arguments)
            if hasattr(result, "__await__"):
                result = await result  # type: ignore[misc]
            return str(result)
        except TypeError as e:
            return f"ERROR: bad arguments — {e}"
        except Exception as e:
            return f"ERROR: {type(e).__name__}: {e}"


# Module-level singleton — tools register themselves on import
registry = ToolRegistry()
