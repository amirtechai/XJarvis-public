"""WHOOP fitness API — recovery, sleep, HRV, RHR, strain.

OAuth-based; expects WHOOP_ACCESS_TOKEN env (refresh handled externally / via
your WHOOP developer dashboard for now). Endpoints from api.prod.whoop.com/v1.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import httpx

from .base import ToolSpec, registry

WHOOP_BASE = "https://api.prod.whoop.com/developer/v1"


def _headers() -> dict | None:
    token = os.getenv("WHOOP_ACCESS_TOKEN", "").strip()
    if not token:
        return None
    return {"Authorization": f"Bearer {token}"}


async def _get(path: str, params: dict | None = None) -> dict | str:
    h = _headers()
    if not h:
        return "ERROR: WHOOP_ACCESS_TOKEN missing"
    async with httpx.AsyncClient(timeout=12.0) as c:
        try:
            r = await c.get(f"{WHOOP_BASE}{path}", headers=h, params=params or {})
        except httpx.HTTPError as e:
            return f"ERROR: {e}"
    if r.status_code != 200:
        return f"ERROR {r.status_code}: {r.text[:200]}"
    return r.json()


async def whoop_recovery() -> str:
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=36)
    data = await _get("/recovery", {"start": start.isoformat(), "end": end.isoformat()})
    if isinstance(data, str):
        return data
    items = data.get("records") or []
    if not items:
        return "(no recovery data in last 36h)"
    latest = items[0]
    score = (latest.get("score") or {})
    return (
        f"Recovery: {score.get('recovery_score','—')}%\n"
        f"HRV: {score.get('hrv_rmssd_milli','—')} ms · RHR: {score.get('resting_heart_rate','—')} bpm\n"
        f"Strain (yesterday): {score.get('strain','—')}"
    )


async def whoop_sleep() -> str:
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=36)
    data = await _get("/activity/sleep", {"start": start.isoformat(), "end": end.isoformat()})
    if isinstance(data, str):
        return data
    items = data.get("records") or []
    if not items:
        return "(no sleep data)"
    latest = items[0]
    score = (latest.get("score") or {})
    stage = (score.get("stage_summary") or {})
    perf = score.get("sleep_performance_percentage", "—")
    eff = score.get("sleep_efficiency_percentage", "—")
    total_min = (stage.get("total_in_bed_time_milli") or 0) / 60000
    return (
        f"Sleep performance: {perf}% · efficiency: {eff}%\n"
        f"In bed: {int(total_min)}min\n"
        f"REM: {int((stage.get('total_rem_sleep_time_milli') or 0) / 60000)}min · "
        f"Deep: {int((stage.get('total_slow_wave_sleep_time_milli') or 0) / 60000)}min"
    )


async def whoop_summary() -> str:
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=36)
    rec, slp = await _get("/recovery", {"start": start.isoformat(), "end": end.isoformat()}), \
               await _get("/activity/sleep", {"start": start.isoformat(), "end": end.isoformat()})
    if isinstance(rec, str):
        return rec
    if isinstance(slp, str):
        return slp
    rscore = ((rec.get("records") or [{}])[0].get("score") or {})
    sscore = ((slp.get("records") or [{}])[0].get("score") or {})
    return (
        f"Recovery {rscore.get('recovery_score','—')}% · "
        f"HRV {rscore.get('hrv_rmssd_milli','—')}ms · "
        f"RHR {rscore.get('resting_heart_rate','—')}bpm · "
        f"Sleep {sscore.get('sleep_performance_percentage','—')}% · "
        f"Strain {rscore.get('strain','—')}"
    )


for spec in [
    ToolSpec(
        name="whoop_summary",
        description="WHOOP tek satır özet: Recovery%, HRV ms, RHR bpm, Sleep%, Strain.",
        parameters={"type": "object", "properties": {}},
        fn=whoop_summary,
    ),
    ToolSpec(
        name="whoop_recovery",
        description="WHOOP recovery (son 36 sa): score, HRV, RHR, strain detaylı.",
        parameters={"type": "object", "properties": {}},
        fn=whoop_recovery,
    ),
    ToolSpec(
        name="whoop_sleep",
        description="WHOOP uyku detayı (son 36 sa): performance/efficiency, REM/Deep dakika.",
        parameters={"type": "object", "properties": {}},
        fn=whoop_sleep,
    ),
]:
    registry.register(spec)
