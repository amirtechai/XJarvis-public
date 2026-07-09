"""MCP (Model Context Protocol) stdio client.

Connects to MCP servers via JSON-RPC 2.0 over stdin/stdout. Compatible with
Claude Desktop's `claude_desktop_config.json` format.

Registry file: ~/.config/xjarvis/mcp.json
{
  "mcpServers": {
    "filesystem": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/x"]},
    "github": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": {"GITHUB_TOKEN": "..."}}
  }
}
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Any

from .tools.base import ToolSpec, registry

CONFIG_PATH = Path.home() / ".config" / "xjarvis" / "mcp.json"
PROTOCOL_VERSION = "2025-06-18"
REQUEST_TIMEOUT_S = 30.0


def _resolve_command(command: str, path: str) -> str:
    """Komutu (npx/node/uvx vb.) verilen PATH üzerinden mutlak yola çöz.

    App'ten spawn edilen agent'ın PATH'i kısıtlı olduğundan çıplak "npx"
    bulunamıyordu; burada Homebrew dahil yaygın yolları tarayıp tam yolu
    döndürüyoruz. Bulunamazsa orijinal komutu bırak (hata loglanır)."""
    if "/" in command:
        return command
    found = shutil.which(command, path=path)
    return found or command


class MCPServer:
    """One MCP server subprocess + JSON-RPC bridge."""

    def __init__(
        self,
        name: str,
        command: str,
        args: list[str],
        env: dict[str, str] | None = None,
    ) -> None:
        self.name = name
        # App'ten spawn edilen agent'ın PATH'i kısıtlı (Homebrew yolları yok) →
        # çıplak "npx"/"node" bulunamayıp MCP sunucuları sessizce düşüyordu
        # (200→118 tool). PATH'i zenginleştir + komutu mutlak yola çöz.
        merged_env = {**os.environ, **(env or {})}
        merged_env["PATH"] = (
            "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:"
            + merged_env.get("PATH", "")
        )
        self.env = merged_env
        self.command = _resolve_command(command, merged_env["PATH"])
        self.args = args
        self._proc: asyncio.subprocess.Process | None = None
        self._next_id = 1
        self._pending: dict[int, asyncio.Future] = {}
        self._reader_task: asyncio.Task | None = None
        self.tools: list[dict] = []

    async def start(self) -> None:
        log_dir = Path.home() / ".jarvis" / "logs" / "mcp"
        log_dir.mkdir(parents=True, exist_ok=True)
        safe_name = (
            "".join(c for c in self.name if c.isalnum() or c in "_-") or "server"
        )
        self._log_path = log_dir / f"{safe_name}.log"
        self._log_fh = open(self._log_path, "a", buffering=1, encoding="utf-8")
        try:
            self._log_fh.write(f"\n=== {safe_name} started ===\n")
            self._proc = await asyncio.create_subprocess_exec(
                self.command,
                *self.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=self.env,
            )
            self._reader_task = asyncio.create_task(self._read_loop())
            self._stderr_task = asyncio.create_task(self._stderr_loop())
            await self._initialize()
            await self._fetch_tools()
        except Exception:
            self._log_fh.close()
            raise

    async def _stderr_loop(self) -> None:
        assert self._proc and self._proc.stderr
        while True:
            line = await self._proc.stderr.readline()
            if not line:
                break
            try:
                self._log_fh.write(line.decode("utf-8", errors="replace"))
            except Exception:
                pass

    async def stop(self) -> None:
        if self._reader_task:
            self._reader_task.cancel()
        if getattr(self, "_stderr_task", None):
            self._stderr_task.cancel()
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=3.0)
            except (asyncio.TimeoutError, ProcessLookupError):
                self._proc.kill()
        if getattr(self, "_log_fh", None):
            try:
                self._log_fh.close()
            except Exception:
                pass

    async def _read_loop(self) -> None:
        assert self._proc and self._proc.stdout
        while True:
            line = await self._proc.stdout.readline()
            if not line:
                break
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            mid = msg.get("id")
            if mid in self._pending:
                fut = self._pending.pop(mid)
                if "error" in msg:
                    fut.set_exception(
                        RuntimeError(msg["error"].get("message", "MCP error"))
                    )
                else:
                    fut.set_result(msg.get("result"))

    async def _send(self, method: str, params: dict | None = None) -> Any:
        assert self._proc and self._proc.stdin
        rid = self._next_id
        self._next_id += 1
        payload = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            payload["params"] = params
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[rid] = fut
        self._proc.stdin.write((json.dumps(payload) + "\n").encode())
        await self._proc.stdin.drain()
        try:
            return await asyncio.wait_for(fut, timeout=REQUEST_TIMEOUT_S)
        except asyncio.TimeoutError:
            self._pending.pop(rid, None)
            raise

    async def _initialize(self) -> None:
        await self._send(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "XJarvis", "version": "0.1.0"},
            },
        )
        # notifications/initialized has no id (notification, not request)
        assert self._proc and self._proc.stdin
        notif = (
            json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"
        )
        self._proc.stdin.write(notif.encode())
        await self._proc.stdin.drain()

    async def _fetch_tools(self) -> None:
        result = await self._send("tools/list")
        self.tools = result.get("tools", []) if result else []

    async def call_tool(self, tool_name: str, arguments: dict) -> str:
        result = await self._send(
            "tools/call", {"name": tool_name, "arguments": arguments}
        )
        if not result:
            return "ERROR: empty result"
        content = result.get("content") or []
        parts: list[str] = []
        for item in content:
            if item.get("type") == "text":
                parts.append(item.get("text", ""))
        is_error = result.get("isError", False)
        prefix = "ERROR: " if is_error else ""
        return prefix + ("\n".join(parts) if parts else json.dumps(result))


class MCPManager:
    """Loads mcp.json, starts all servers, registers their tools into the global registry."""

    def __init__(self) -> None:
        self.servers: dict[str, MCPServer] = {}

    @staticmethod
    def load_config() -> dict:
        if not CONFIG_PATH.exists():
            return {}
        try:
            return json.loads(CONFIG_PATH.read_text())
        except Exception as e:
            print(f"[mcp] config parse error: {e}", flush=True)
            return {}

    async def start_all(self) -> None:
        cfg = self.load_config()
        servers_cfg = cfg.get("mcpServers", {})
        for name, sc in servers_cfg.items():
            command = sc.get("command")
            if not command:
                continue
            srv = MCPServer(
                name=name,
                command=command,
                args=sc.get("args", []),
                env=sc.get("env", {}),
            )
            try:
                await srv.start()
                self.servers[name] = srv
                self._register_tools(srv)
                print(f"[mcp] {name}: {len(srv.tools)} tools loaded", flush=True)
            except Exception as e:
                print(f"[mcp] {name} failed to start: {e}", flush=True)

    def _register_tools(self, srv: MCPServer) -> None:
        for tool in srv.tools:
            tool_name = tool.get("name", "")
            namespaced = f"mcp_{srv.name}_{tool_name}"
            description = tool.get("description", f"{srv.name}.{tool_name} (MCP)")
            params = tool.get("inputSchema") or {"type": "object", "properties": {}}

            async def _invoke(_srv=srv, _tn=tool_name, **kwargs):
                return await _srv.call_tool(_tn, kwargs)

            registry.register(
                ToolSpec(
                    name=namespaced,
                    description=f"[MCP/{srv.name}] {description}",
                    parameters=params,
                    fn=_invoke,
                )
            )

    async def stop_all(self) -> None:
        for srv in self.servers.values():
            await srv.stop()
        self.servers.clear()
