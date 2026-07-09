"""Smoke tests for built-in tools — verify registry + execution."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest

from agent.tools import registry  # noqa: E402  (auto-registers via __init__)


def test_registry_has_core_tools():
    expected = {
        "shell_exec", "open_app", "applescript", "notify", "frontmost_app",
        "file_read", "file_write", "list_dir",
        "web_search", "web_fetch",
        "clipboard_read", "clipboard_write",
    }
    assert expected.issubset(set(registry.names()))


def test_specs_have_openai_schema():
    for spec in registry.all_specs():
        assert spec["type"] == "function"
        fn = spec["function"]
        assert "name" in fn and "description" in fn and "parameters" in fn
        assert fn["parameters"].get("type") == "object"


def test_unknown_tool_returns_error():
    result = asyncio.run(registry.execute("nope_does_not_exist", {}))
    assert "ERROR" in result and "unknown" in result.lower()


def test_shell_exec_basic():
    result = asyncio.run(registry.execute("shell_exec", {"command": "echo hi"}))
    assert "hi" in result
    assert "exit=0" in result


def test_file_io_roundtrip(tmp_path):
    p = tmp_path / "x.txt"
    asyncio.run(registry.execute("file_write", {"path": str(p), "content": "hello"}))
    result = asyncio.run(registry.execute("file_read", {"path": str(p)}))
    assert result == "hello"


def test_list_dir_returns_entries(tmp_path):
    (tmp_path / "a.txt").write_text("x")
    (tmp_path / "sub").mkdir()
    result = asyncio.run(registry.execute("list_dir", {"path": str(tmp_path)}))
    assert "a.txt" in result and "sub" in result
