"""Notification & system-pulse tools.

macOS Notification Center stores deliveries in a private SQLite DB at
~/Library/Group Containers/group.com.apple.usernoted/db2/db
which only readable with Full Disk Access. We try it; if it fails, we
return a clear error.

`system_pulse` aggregates a "what should I tell the user" view
(unread mail, due reminders, upcoming events, focused app, system load).
"""
from __future__ import annotations

import asyncio
import os
import sqlite3
import time
from pathlib import Path

import httpx

from .base import ToolSpec, registry

NC_DB = Path.home() / "Library" / "Group Containers" / "group.com.apple.usernoted" / "db2" / "db"


async def _osascript(script: str, timeout: float = 5.0) -> str:
    proc = await asyncio.create_subprocess_exec(
        "osascript", "-e", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return "ERROR: timeout"
    if proc.returncode != 0:
        return f"ERROR: {stderr.decode().strip()}"
    return stdout.decode().strip()


# ─── Notification Center reader ────────────────────────────────────────


async def notifications_recent(limit: int = 10) -> str:
    """Recent macOS notifications (requires Full Disk Access for the launching process)."""
    if not NC_DB.exists():
        return "ERROR: notification DB not found"
    try:
        conn = sqlite3.connect(f"file:{NC_DB}?mode=ro", uri=True, timeout=2.0)
    except sqlite3.OperationalError as e:
        return f"ERROR: open failed ({e}) — Full Disk Access gerekli"
    try:
        # Schema varies by macOS version. Try the modern (Ventura+) layout first.
        rows = []
        try:
            cur = conn.execute(
                "SELECT app.identifier, "
                "   datetime(record.delivered_date + 978307200, 'unixepoch', 'localtime'), "
                "   record.data "
                "FROM record "
                "JOIN app ON record.app_id = app.app_id "
                "ORDER BY record.delivered_date DESC LIMIT ?",
                (max(1, min(int(limit), 50)),),
            )
            rows = cur.fetchall()
        except sqlite3.OperationalError:
            return "ERROR: schema mismatch (macOS sürüm farklı olabilir)"
        out = []
        for app_id, when, blob in rows:
            title, body = _decode_plist_titlebody(blob)
            out.append(f"[{when}] {app_id}: {title} — {body[:120]}")
        return "\n".join(out) or "(boş)"
    finally:
        conn.close()


def _decode_plist_titlebody(blob) -> tuple[str, str]:
    """Best-effort: extract title/body from Apple's binary plist payload."""
    if not blob:
        return ("", "")
    try:
        import plistlib
        data = plistlib.loads(blob) if isinstance(blob, (bytes, bytearray)) else {}
        req = (data.get("req") or {}) if isinstance(data, dict) else {}
        return (str(req.get("titl") or ""), str(req.get("body") or ""))
    except Exception:
        return ("", "")


# ─── System pulse aggregator ───────────────────────────────────────────


async def system_pulse() -> str:
    """One-shot snapshot: unread mail count, reminders due, upcoming events, frontmost app, CPU/RAM."""

    async def _mail() -> str:
        try:
            return await _osascript('tell application "Mail" to count (messages of inbox whose read status is false)')
        except Exception:
            return "?"

    async def _reminders_due() -> str:
        s = '''
        tell application "Reminders"
          set due to (count of (every reminder whose completed is false and due date is not missing value))
          return due as string
        end tell
        '''
        try: return await _osascript(s)
        except Exception: return "?"

    async def _next_event() -> str:
        s = '''
        tell application "Calendar"
          set t1 to current date
          set t2 to t1 + (4 * hours)
          repeat with cal in calendars
            try
              set evs to (every event of cal whose start date >= t1 and start date <= t2)
              if (count of evs) > 0 then
                set ev to first item of evs
                return (summary of ev) & " | " & (start date of ev as string)
              end if
            end try
          end repeat
          return "—"
        end tell
        '''
        try: return await _osascript(s, timeout=10.0)
        except Exception: return "?"

    async def _frontmost() -> str:
        try: return await _osascript('tell application "System Events" to name of first application process whose frontmost is true')
        except Exception: return "?"

    async def _stats() -> str:
        try:
            async with httpx.AsyncClient(timeout=2.0) as c:
                r = await c.get("http://127.0.0.1:3001/api/system-stats")
            if r.status_code != 200:
                return "?"
            d = r.json()
            cpu = d.get("cpu", {}).get("load", 0)
            ram = d.get("ram", {}).get("percent", 0)
            return f"CPU {cpu:.0f}% · RAM {ram:.0f}%"
        except Exception:
            return "?"

    mail, due, ev, focus, stats = await asyncio.gather(
        _mail(), _reminders_due(), _next_event(), _frontmost(), _stats(),
    )
    when = time.strftime("%H:%M", time.localtime())
    return (
        f"[{when}] Mail unread: {mail} · Reminders due: {due} · "
        f"Next event (4h): {ev} · Focus: {focus} · {stats}"
    )


for spec in [
    ToolSpec(
        name="notifications_recent",
        description=(
            "Son N macOS bildirimini listele (Full Disk Access gerekli). "
            "İzin yoksa açıklayıcı hata döner."
        ),
        parameters={
            "type": "object",
            "properties": {"limit": {"type": "integer", "description": "1-50"}},
        },
        fn=notifications_recent,
    ),
    ToolSpec(
        name="system_pulse",
        description=(
            "Tek seferde durum özeti: okunmamış mail sayısı, due hatırlatıcılar, "
            "önümüzdeki 4 saatteki etkinlikler, aktif uygulama, CPU/RAM. "
            "'Ne durumda', 'günaydın brief', 'durum' gibi sorular için."
        ),
        parameters={"type": "object", "properties": {}},
        fn=system_pulse,
    ),
]:
    registry.register(spec)
