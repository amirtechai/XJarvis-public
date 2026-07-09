#!/usr/bin/env python3
import os
"""Trigger a connector sync via OpenJarvis Python API.

Usage: python3 connector_sync.py <ConnectorName>
Prints JSON progress lines: {"items": N} or {"done": true, "total": N} or {"err": "msg"}
"""
import sys
import json

sys.path.insert(0, os.environ.get('OPENJARVIS_SRC', ''))


def main(name: str) -> None:
    try:
        import openjarvis.connectors  # noqa: F401 — registers subclasses
        from openjarvis.connectors._stubs import BaseConnector
        from openjarvis.connectors.sync_engine import SyncEngine
        from openjarvis.connectors.pipeline import IngestionPipeline
        from openjarvis.connectors.store import KnowledgeStore
    except Exception as e:
        print(json.dumps({"err": f"Import error: {e}"}))
        return

    # Find connector class by name (strip trailing "Connector" suffix if absent)
    cls = None
    for sub in BaseConnector.__subclasses__():
        candidate = sub.__name__.replace('Connector', '')
        if candidate.lower() == name.lower() or sub.__name__.lower() == name.lower():
            cls = sub
            break

    if cls is None:
        print(json.dumps({"err": f"Connector '{name}' not found"}))
        return

    try:
        inst = cls()
        if not inst.is_connected():
            print(json.dumps({"err": f"{name} is not connected"}))
            return

        store = KnowledgeStore()
        pipeline = IngestionPipeline(store)
        engine = SyncEngine(pipeline)
        total = engine.sync(inst)
        print(json.dumps({"done": True, "total": total}))
    except Exception as e:
        print(json.dumps({"err": str(e)}))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"err": "Usage: connector_sync.py <ConnectorName>"}))
        sys.exit(1)
    main(sys.argv[1])
