#!/usr/bin/env python3
import os
"""Knowledge search helper for meeting-brief.js.

Reads a JSON arg blob (query, source, since, top_k), runs filtered BM25
retrieval against the KnowledgeStore, and prints a JSON list of hits to
stdout. Each hit is {source, title, snippet, score, url, doc_id}.
"""
import json
import sys

sys.path.insert(0, os.environ.get('OPENJARVIS_SRC', ''))


def main(arg: str) -> None:
    try:
        params = json.loads(arg)
    except Exception:
        print("[]")
        return

    query = (params.get("query") or "").strip()
    if not query:
        print("[]")
        return

    try:
        from openjarvis.connectors.store import KnowledgeStore

        store = KnowledgeStore()
        kwargs = {}
        if params.get("source"):
            kwargs["source"] = params["source"]
        if params.get("since"):
            kwargs["since"] = params["since"]
        results = store.retrieve(query, top_k=int(params.get("top_k", 5)), **kwargs)
    except Exception as exc:
        print(json.dumps([{"error": str(exc)}]))
        return

    out = []
    for r in results:
        meta = getattr(r, "metadata", {}) or {}
        snippet = (getattr(r, "content", "") or "")[:240]
        out.append({
            "source": getattr(r, "source", "") or meta.get("source", ""),
            "title": meta.get("title", ""),
            "author": meta.get("author", ""),
            "url": meta.get("url", ""),
            "doc_id": meta.get("doc_id", ""),
            "snippet": snippet,
            "score": float(getattr(r, "score", 0.0) or 0.0),
        })
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "{}")
