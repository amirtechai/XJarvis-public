"""Episodic memory + cost tracking via SQLite (zero deps)."""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent.parent / "logs" / "xjarvis.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    query TEXT NOT NULL,
    response TEXT,
    tools_used TEXT,
    duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_episodes_ts ON episodes(ts);

CREATE TABLE IF NOT EXISTS cost_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    day TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    cost_usd REAL
);
CREATE INDEX IF NOT EXISTS idx_cost_day ON cost_ledger(day);

CREATE TABLE IF NOT EXISTS facts (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at REAL
);

CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    episode_id INTEGER,
    name TEXT NOT NULL,
    args TEXT,
    result_preview TEXT
);
CREATE INDEX IF NOT EXISTS idx_tc_ts ON tool_calls(ts);
CREATE INDEX IF NOT EXISTS idx_tc_episode ON tool_calls(episode_id);

CREATE TABLE IF NOT EXISTS turn_latency (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    model TEXT,
    total_ms INTEGER,
    ttft_ms INTEGER,
    tool_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_latency_ts ON turn_latency(ts);
"""


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.executescript(SCHEMA)
    return c


def record_episode(query: str, response: str, tools_used: list[str], duration_ms: int) -> int:
    """Insert an episode row and return its id."""
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO episodes(ts, query, response, tools_used, duration_ms) VALUES (?,?,?,?,?)",
            (time.time(), query, response, ",".join(tools_used), duration_ms),
        )
        return int(cur.lastrowid or 0)


def record_tool_call(name: str, args: dict, result: str, episode_id: int | None = None) -> int:
    import json as _json
    args_json = _json.dumps(args or {}, ensure_ascii=False)
    preview = (result or "")[:500]
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO tool_calls(ts, episode_id, name, args, result_preview) VALUES (?,?,?,?,?)",
            (time.time(), episode_id, name, args_json, preview),
        )
        return int(cur.lastrowid or 0)


def attach_tool_calls(ids: list[int], episode_id: int) -> None:
    if not ids or not episode_id:
        return
    with _conn() as c:
        c.executemany(
            "UPDATE tool_calls SET episode_id=? WHERE id=?",
            [(episode_id, i) for i in ids],
        )


def recent_tool_calls(episode_id: int | None = None, limit: int = 50) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    import json as _json
    with _conn() as c:
        if episode_id is not None:
            rows = c.execute(
                "SELECT id, ts, episode_id, name, args, result_preview FROM tool_calls "
                "WHERE episode_id=? ORDER BY ts ASC LIMIT ?",
                (episode_id, limit),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT id, ts, episode_id, name, args, result_preview FROM tool_calls "
                "ORDER BY ts DESC LIMIT ?",
                (limit,),
            ).fetchall()
    out: list[dict] = []
    for r in rows:
        try:
            args = _json.loads(r[4] or "{}")
        except Exception:
            args = {}
        out.append({
            "id": r[0], "ts": r[1], "episode_id": r[2],
            "name": r[3], "args": args, "result_preview": r[5],
        })
    return out


def get_tool_call(call_id: int) -> dict | None:
    import json as _json
    with _conn() as c:
        row = c.execute(
            "SELECT id, ts, episode_id, name, args, result_preview FROM tool_calls WHERE id=?",
            (call_id,),
        ).fetchone()
    if not row:
        return None
    try:
        args = _json.loads(row[4] or "{}")
    except Exception:
        args = {}
    return {
        "id": row[0], "ts": row[1], "episode_id": row[2],
        "name": row[3], "args": args, "result_preview": row[5],
    }


def recent_episodes(limit: int = 10) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT id, ts, query, response, tools_used, duration_ms FROM episodes "
            "ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {
            "id": r[0],
            "ts": r[1],
            "query": r[2],
            "response": r[3],
            "tools_used": r[4],
            "duration_ms": r[5],
        }
        for r in rows
    ]


def episode_count() -> int:
    with _conn() as c:
        row = c.execute("SELECT COUNT(*) FROM episodes").fetchone()
    return int(row[0] or 0)


def delete_all_episodes() -> int:
    """Right-to-erasure helper. Returns number of rows deleted."""
    with _conn() as c:
        cur = c.execute("DELETE FROM episodes")
        return cur.rowcount or 0


def search_episodes(query: str, limit: int = 5) -> list[dict]:
    """Substring search — sqlite-vec eklenince upgrade edilir."""
    with _conn() as c:
        rows = c.execute(
            "SELECT ts, query, response FROM episodes WHERE query LIKE ? OR response LIKE ? "
            "ORDER BY ts DESC LIMIT ?",
            (f"%{query}%", f"%{query}%", limit),
        ).fetchall()
    return [{"ts": r[0], "query": r[1], "response": r[2]} for r in rows]


def record_cost(model: str, prompt_tokens: int, completion_tokens: int, cost_usd: float) -> None:
    day = time.strftime("%Y-%m-%d", time.localtime())
    with _conn() as c:
        c.execute(
            "INSERT INTO cost_ledger(ts, day, model, prompt_tokens, completion_tokens, cost_usd) "
            "VALUES (?,?,?,?,?,?)",
            (time.time(), day, model, prompt_tokens, completion_tokens, cost_usd),
        )


def daily_spend_usd() -> float:
    day = time.strftime("%Y-%m-%d", time.localtime())
    with _conn() as c:
        row = c.execute(
            "SELECT COALESCE(SUM(cost_usd),0) FROM cost_ledger WHERE day=?", (day,),
        ).fetchone()
    return float(row[0] or 0.0)


def fact_set(key: str, value: str) -> None:
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO facts(key, value, updated_at) VALUES (?,?,?)",
            (key, value, time.time()),
        )


def fact_get(key: str) -> str | None:
    with _conn() as c:
        row = c.execute("SELECT value FROM facts WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def all_facts() -> dict[str, str]:
    with _conn() as c:
        rows = c.execute("SELECT key, value FROM facts").fetchall()
    return {k: v for k, v in rows}


def record_latency(model: str, total_ms: int, ttft_ms: int | None, tool_count: int) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO turn_latency(ts, model, total_ms, ttft_ms, tool_count) VALUES (?,?,?,?,?)",
            (time.time(), model, total_ms, ttft_ms, tool_count),
        )


def latency_stats(window_minutes: int = 60) -> dict:
    """Return p50/p95/p99 + count for the recent window."""
    cutoff = time.time() - window_minutes * 60
    with _conn() as c:
        rows = c.execute(
            "SELECT total_ms, ttft_ms FROM turn_latency WHERE ts >= ? ORDER BY total_ms",
            (cutoff,),
        ).fetchall()
    if not rows:
        return {"count": 0}
    totals = [r[0] for r in rows if r[0] is not None]
    ttfts = sorted([r[1] for r in rows if r[1] is not None])

    def pct(values: list[int], p: float) -> int | None:
        if not values:
            return None
        idx = max(0, min(len(values) - 1, int(round(p * (len(values) - 1)))))
        return values[idx]

    return {
        "count": len(rows),
        "total_p50": pct(totals, 0.50),
        "total_p95": pct(totals, 0.95),
        "total_p99": pct(totals, 0.99),
        "ttft_p50": pct(ttfts, 0.50),
        "ttft_p95": pct(ttfts, 0.95),
    }


def recent_latencies(limit: int = 20) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT ts, model, total_ms, ttft_ms, tool_count FROM turn_latency "
            "ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {"ts": r[0], "model": r[1], "total_ms": r[2], "ttft_ms": r[3], "tool_count": r[4]}
        for r in rows
    ]
