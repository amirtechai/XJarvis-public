"""Rate limiter — sliding window per-minute and per-hour query caps.

Env config:
  RATE_LIMIT_PER_MIN  (default 30)
  RATE_LIMIT_PER_HOUR (default 400)
  RATE_LIMIT          (set to 'off' to disable)
"""
from __future__ import annotations

import os
import time
from collections import deque

PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "30"))
PER_HOUR = int(os.getenv("RATE_LIMIT_PER_HOUR", "400"))


def _enabled() -> bool:
    return os.getenv("RATE_LIMIT", "auto").lower() not in ("off", "false", "0", "disabled")


_log: deque[float] = deque()


def _trim(now: float) -> None:
    while _log and _log[0] < now - 3600:
        _log.popleft()


def check() -> tuple[bool, str]:
    """Return (allowed, reason). Records the call when allowed."""
    if not _enabled():
        return True, ""
    now = time.time()
    _trim(now)
    in_min = sum(1 for ts in _log if ts > now - 60)
    in_hour = len(_log)
    if in_min >= PER_MIN:
        return False, f"rate limit: {in_min}/{PER_MIN} requests in last 60s"
    if in_hour >= PER_HOUR:
        return False, f"rate limit: {in_hour}/{PER_HOUR} requests in last hour"
    _log.append(now)
    return True, ""


def stats() -> dict:
    now = time.time()
    _trim(now)
    return {
        "per_min": sum(1 for ts in _log if ts > now - 60),
        "per_min_cap": PER_MIN,
        "per_hour": len(_log),
        "per_hour_cap": PER_HOUR,
        "enabled": _enabled(),
    }
