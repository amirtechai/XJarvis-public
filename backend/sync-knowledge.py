#!/usr/bin/env python3
"""KnowledgeStore export/import bridge for multi-machine sync.

Uses direct SQL against ``knowledge_chunks`` (created_at > ?) for
incremental export — no FTS5 wildcard hack. Imports go through the
public ``store()`` API so triggers + indexes stay coherent.

Usage:
  export <json-args>   stdout = JSON list of chunks newer than `since_epoch`
  import                stdin = JSON list, stdout = {"imported": N}
"""
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, os.environ.get('OPENJARVIS_SRC', ''))


def _db_path() -> str:
    home = Path.home()
    candidates = [
        home / ".openjarvis" / "knowledge.db",
        home / ".local" / "share" / "openjarvis" / "knowledge.db",
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return str(candidates[0])


def export_since(args: dict) -> None:
    since_epoch = float(args.get("since_epoch", 0) or 0)
    limit = int(args.get("limit", 1000))
    db = _db_path()
    if not Path(db).exists():
        print("[]")
        return

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT id, doc_id, content, source, doc_type, title, author,
               participants, timestamp, thread_id, url, metadata,
               chunk_index, created_at
        FROM knowledge_chunks
        WHERE created_at > ?
        ORDER BY created_at ASC
        LIMIT ?
        """,
        (since_epoch, limit),
    ).fetchall()
    conn.close()

    out = []
    for r in rows:
        try:
            metadata = json.loads(r["metadata"]) if r["metadata"] else {}
        except Exception:
            metadata = {}
        try:
            participants = json.loads(r["participants"]) if r["participants"] else []
        except Exception:
            participants = []
        out.append({
            "chunk_id": r["id"],
            "doc_id": r["doc_id"],
            "content": r["content"],
            "source": r["source"],
            "doc_type": r["doc_type"],
            "title": r["title"],
            "author": r["author"],
            "participants": participants,
            "timestamp": r["timestamp"],
            "thread_id": r["thread_id"],
            "url": r["url"],
            "metadata": metadata,
            "chunk_index": r["chunk_index"],
            "created_at": r["created_at"],
        })
    print(json.dumps({"chunks": out, "max_created_at": rows[-1]["created_at"] if rows else since_epoch}, ensure_ascii=False))


def import_chunks() -> None:
    raw = sys.stdin.read() or "[]"
    try:
        data = json.loads(raw)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return

    chunks = data.get("chunks") if isinstance(data, dict) else data
    if not isinstance(chunks, list):
        print(json.dumps({"ok": False, "error": "expected list"}))
        return

    try:
        from openjarvis.connectors.store import KnowledgeStore
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return

    store = KnowledgeStore()
    db = _db_path()
    conn = sqlite3.connect(db)

    # Build a set of doc_ids we already have so we can skip duplicates.
    existing = {row[0] for row in conn.execute("SELECT DISTINCT doc_id FROM knowledge_chunks").fetchall()}
    conn.close()

    imported = 0
    skipped = 0
    for c in chunks:
        if not c.get("content"):
            continue
        if c.get("doc_id") in existing:
            skipped += 1
            continue
        try:
            store.store(
                content=c["content"],
                source=c.get("source", ""),
                doc_type=c.get("doc_type", ""),
                doc_id=c.get("doc_id") or None,
                title=c.get("title", ""),
                author=c.get("author", ""),
                participants=c.get("participants", []) or [],
                timestamp=c.get("timestamp") or None,
                thread_id=c.get("thread_id") or None,
                url=c.get("url") or None,
                metadata=c.get("metadata", {}) or {},
                chunk_index=int(c.get("chunk_index", 0)),
            )
            imported += 1
        except Exception:
            continue

    print(json.dumps({"ok": True, "imported": imported, "skipped": skipped}))


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: export <json-args> | import"}))
        return
    cmd = sys.argv[1]
    if cmd == "export":
        args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        export_since(args)
    elif cmd == "import":
        import_chunks()
    else:
        print(json.dumps({"error": f"unknown cmd {cmd}"}))


if __name__ == "__main__":
    main()
