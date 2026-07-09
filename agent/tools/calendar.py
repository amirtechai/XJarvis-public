"""Calendar + Reminders tools — bridge to macOS Calendar.app & Reminders.app via osascript."""
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


def _quote(s: str) -> str:
    return s.replace('"', '\\"').replace('\n', ' ')


# ─── Calendar ───────────────────────────────────────────────────────────


async def calendar_today_events() -> str:
    """List today's events across all Calendar.app calendars."""
    script = '''
    set out to ""
    tell application "Calendar"
      set today to current date
      set time of today to 0
      set tomorrow to today + (1 * days)
      repeat with cal in calendars
        try
          set evs to (every event of cal whose start date >= today and start date < tomorrow)
          repeat with ev in evs
            set out to out & (summary of ev) & " | " & (start date of ev as string) & linefeed
          end repeat
        end try
      end repeat
    end tell
    return out
    '''
    res = await _osascript(script)
    return res or "(bugün etkinlik yok)"


async def calendar_upcoming_events(days: int = 7) -> str:
    """List events in the next N days (default 7)."""
    days = max(1, min(int(days), 60))
    script = f'''
    set out to ""
    tell application "Calendar"
      set t1 to current date
      set t2 to t1 + ({days} * days)
      repeat with cal in calendars
        try
          set evs to (every event of cal whose start date >= t1 and start date <= t2)
          repeat with ev in evs
            set out to out & (summary of ev) & " | " & (start date of ev as string) & linefeed
          end repeat
        end try
      end repeat
    end tell
    return out
    '''
    res = await _osascript(script)
    return res or f"(önümüzdeki {days} gün etkinlik yok)"


async def calendar_create_event(
    title: str,
    start_iso: str,
    duration_minutes: int = 60,
    calendar_name: str = "",
    notes: str = "",
) -> str:
    """Create an event. start_iso: 'YYYY-MM-DD HH:MM' in local time."""
    cal_clause = f'calendar "{_quote(calendar_name)}"' if calendar_name else 'first calendar'
    notes_clause = f', description:"{_quote(notes)}"' if notes else ''
    script = f'''
    tell application "Calendar"
      set newDate to date "{_quote(start_iso)}"
      set endDate to newDate + ({int(duration_minutes)} * minutes)
      tell {cal_clause}
        make new event with properties {{summary:"{_quote(title)}", start date:newDate, end date:endDate{notes_clause}}}
      end tell
    end tell
    return "OK"
    '''
    return await _osascript(script)


# ─── Reminders ──────────────────────────────────────────────────────────


async def reminders_list(only_open: bool = True) -> str:
    """List reminders. only_open=true filters out completed."""
    where = " whose completed is false" if only_open else ""
    script = f'''
    set out to ""
    tell application "Reminders"
      repeat with r in (every reminder{where})
        try
          set due to "(due: " & ((due date of r) as string) & ")"
        on error
          set due to ""
        end try
        set out to out & (name of r) & " " & due & linefeed
      end repeat
    end tell
    return out
    '''
    res = await _osascript(script)
    return res or "(hatırlatıcı yok)"


async def reminders_add(name: str, due_iso: str = "", body: str = "") -> str:
    """Create a reminder. due_iso optional ('YYYY-MM-DD HH:MM')."""
    parts = [f'name:"{_quote(name)}"']
    if body:
        parts.append(f'body:"{_quote(body)}"')
    if due_iso:
        parts.append(f'due date:(date "{_quote(due_iso)}")')
    script = f'''
    tell application "Reminders"
      make new reminder with properties {{{', '.join(parts)}}}
    end tell
    return "OK"
    '''
    return await _osascript(script)


async def reminders_complete(name_substring: str) -> str:
    """Mark the first matching open reminder complete."""
    script = f'''
    tell application "Reminders"
      set matches to (every reminder whose completed is false and name contains "{_quote(name_substring)}")
      if (count of matches) is 0 then return "NO MATCH"
      set r to first item of matches
      set completed of r to true
      return "OK: " & (name of r)
    end tell
    '''
    return await _osascript(script)


# ─── Registration ───────────────────────────────────────────────────────


for spec in [
    ToolSpec(
        name="calendar_today",
        description="Bugünün takvim etkinliklerini listele.",
        parameters={"type": "object", "properties": {}},
        fn=calendar_today_events,
    ),
    ToolSpec(
        name="calendar_upcoming",
        description="Önümüzdeki N gün içindeki etkinlikler (varsayılan 7).",
        parameters={
            "type": "object",
            "properties": {"days": {"type": "integer", "description": "1-60"}},
        },
        fn=calendar_upcoming_events,
    ),
    ToolSpec(
        name="calendar_create",
        description=(
            "Yeni Calendar etkinliği oluştur. start_iso 'YYYY-MM-DD HH:MM' formatında "
            "yerel saat. duration_minutes varsayılan 60. calendar_name boşsa ilk takvim."
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "start_iso": {"type": "string", "description": "YYYY-MM-DD HH:MM"},
                "duration_minutes": {"type": "integer"},
                "calendar_name": {"type": "string"},
                "notes": {"type": "string"},
            },
            "required": ["title", "start_iso"],
        },
        fn=calendar_create_event,
    ),
    ToolSpec(
        name="reminders_list",
        description="Reminders.app'tan açık (veya tüm) hatırlatıcıları listele.",
        parameters={
            "type": "object",
            "properties": {"only_open": {"type": "boolean"}},
        },
        fn=reminders_list,
    ),
    ToolSpec(
        name="reminders_add",
        description=(
            "Yeni hatırlatıcı ekle. due_iso opsiyonel 'YYYY-MM-DD HH:MM'. "
            "body opsiyonel açıklama."
        ),
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "due_iso": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["name"],
        },
        fn=reminders_add,
    ),
    ToolSpec(
        name="reminders_complete",
        description="İsme göre eşleşen ilk açık hatırlatıcıyı tamamla işaretle.",
        parameters={
            "type": "object",
            "properties": {
                "name_substring": {"type": "string", "description": "İsim içinde geçen alt-string"},
            },
            "required": ["name_substring"],
        },
        fn=reminders_complete,
    ),
]:
    registry.register(spec)
