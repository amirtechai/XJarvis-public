"""Apple Mail.app tools — read inbox + compose replies via osascript."""
from __future__ import annotations

import asyncio

from .base import ToolSpec, registry


async def _osascript(script: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        "osascript", "-e", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return f"ERROR: {stderr.decode().strip()}"
    return stdout.decode().strip() or "OK"


def _q(s: str) -> str:
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')


async def mail_unread_count() -> str:
    """Count of unread messages across all inboxes."""
    return await _osascript('tell application "Mail" to count (messages of inbox whose read status is false)')


async def mail_recent(limit: int = 10, unread_only: bool = False) -> str:
    """List recent inbox messages: subject + sender + age."""
    limit = max(1, min(int(limit), 50))
    where = " whose read status is false" if unread_only else ""
    script = f'''
    set out to ""
    tell application "Mail"
      set msgs to (messages of inbox{where})
      set n to count of msgs
      if n > {limit} then set n to {limit}
      repeat with i from 1 to n
        set m to item i of msgs
        try
          set s to subject of m
        on error
          set s to "(no subject)"
        end try
        try
          set f to sender of m
        on error
          set f to "(no sender)"
        end try
        try
          set d to date received of m as string
        on error
          set d to ""
        end try
        set unread to ""
        try
          if read status of m is false then set unread to "● "
        end try
        set out to out & unread & f & " | " & s & " | " & d & linefeed
      end repeat
    end tell
    return out
    '''
    res = await _osascript(script)
    return res or "(boş)"


async def mail_read(index: int = 1) -> str:
    """Read a specific message body by inbox index (1-based, latest first)."""
    idx = max(1, int(index))
    script = f'''
    tell application "Mail"
      set m to item {idx} of (messages of inbox)
      set s to subject of m
      set f to sender of m
      set b to content of m
      return "From: " & f & linefeed & "Subject: " & s & linefeed & linefeed & b
    end tell
    '''
    return await _osascript(script)


async def mail_archive(index: int) -> str:
    """Archive a message by inbox index (1-based, latest first)."""
    idx = max(1, int(index))
    script = f'''
    tell application "Mail"
      set m to item {idx} of (messages of inbox)
      archive m
    end tell
    return "OK: archived"
    '''
    return await _osascript(script)


async def mail_send(to: str, subject: str, body: str, cc: str = "", send_now: bool = False) -> str:
    """Compose a new mail. send_now=false leaves it as a saved draft."""
    cc_line = f'make new cc recipient at end of cc recipients with properties {{address:"{_q(cc)}"}}\n' if cc else ''
    action = 'send' if send_now else 'save'
    script = f'''
    tell application "Mail"
      set newMessage to make new outgoing message with properties {{subject:"{_q(subject)}", content:"{_q(body)}", visible:true}}
      tell newMessage
        make new to recipient at end of to recipients with properties {{address:"{_q(to)}"}}
        {cc_line}
      end tell
      {action} newMessage
    end tell
    return "OK: {_q(action)}"
    '''
    return await _osascript(script)


async def mail_reply(index: int, body: str, send_now: bool = False) -> str:
    """Reply to message at inbox index (1-based)."""
    idx = max(1, int(index))
    action = 'send' if send_now else 'save'
    script = f'''
    tell application "Mail"
      set m to item {idx} of (messages of inbox)
      set replyMsg to reply m with opening window
      tell replyMsg
        set content to "{_q(body)}" & return & content
      end tell
      {action} replyMsg
    end tell
    return "OK: {_q(action)}"
    '''
    return await _osascript(script)


for spec in [
    ToolSpec(
        name="mail_unread_count",
        description="Apple Mail inbox'taki okunmamış mesaj sayısı.",
        parameters={"type": "object", "properties": {}},
        fn=mail_unread_count,
    ),
    ToolSpec(
        name="mail_recent",
        description=(
            "Son N inbox mesajını listele (özet: gönderici | konu | tarih). "
            "unread_only=true sadece okunmamış."
        ),
        parameters={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "1-50, varsayılan 10"},
                "unread_only": {"type": "boolean"},
            },
        },
        fn=mail_recent,
    ),
    ToolSpec(
        name="mail_read",
        description="Inbox'taki belirli mesajı (1-tabanlı index) tam olarak oku.",
        parameters={
            "type": "object",
            "properties": {"index": {"type": "integer"}},
            "required": ["index"],
        },
        fn=mail_read,
    ),
    ToolSpec(
        name="mail_send",
        description=(
            "Yeni mail oluştur. send_now=false (varsayılan) ile draft olarak kaydeder, "
            "send_now=true gönderir. cc opsiyonel."
        ),
        parameters={
            "type": "object",
            "properties": {
                "to": {"type": "string"},
                "subject": {"type": "string"},
                "body": {"type": "string"},
                "cc": {"type": "string"},
                "send_now": {"type": "boolean"},
            },
            "required": ["to", "subject", "body"],
        },
        fn=mail_send,
    ),
    ToolSpec(
        name="mail_reply",
        description=(
            "Belirli bir inbox mesajına yanıt yaz. send_now=false (varsayılan) draft "
            "kaydeder, send_now=true direkt gönderir. body yanıtın başına eklenir."
        ),
        parameters={
            "type": "object",
            "properties": {
                "index": {"type": "integer"},
                "body": {"type": "string"},
                "send_now": {"type": "boolean"},
            },
            "required": ["index", "body"],
        },
        fn=mail_reply,
    ),
    ToolSpec(
        name="mail_archive",
        description="Inbox'taki mesajı arşive taşı (1-tabanlı index).",
        parameters={
            "type": "object",
            "properties": {"index": {"type": "integer"}},
            "required": ["index"],
        },
        fn=mail_archive,
    ),
]:
    registry.register(spec)
