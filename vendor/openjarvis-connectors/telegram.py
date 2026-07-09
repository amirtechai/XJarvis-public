"""Telegram connector — sync incoming chat messages into the knowledge store.

Reuses the same Bot API token as the TelegramChannel. On each sync we pull
updates via long-poll-style ``getUpdates`` (with offset persisted to a cursor
file) and yield one Document per text message. The result is that everything
people send to the bot becomes searchable via cross-connector RAG alongside
Gmail, Slack, WhatsApp, etc.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

import httpx

from openjarvis.connectors._stubs import BaseConnector, Document, SyncStatus
from openjarvis.core.config import DEFAULT_CONFIG_DIR
from openjarvis.core.registry import ConnectorRegistry

_TG_API_BASE = "https://api.telegram.org"
_DEFAULT_STATE_PATH = str(DEFAULT_CONFIG_DIR / "connectors" / "telegram.json")


def _tg_get_updates(token: str, offset: int = 0, limit: int = 100) -> Dict[str, Any]:
    """Pull Telegram updates starting from *offset*."""
    resp = httpx.get(
        f"{_TG_API_BASE}/bot{token}/getUpdates",
        params={"offset": offset, "limit": limit, "timeout": 0},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


@ConnectorRegistry.register("telegram")
class TelegramConnector(BaseConnector):
    """Sync recent Telegram bot messages into the knowledge store."""

    connector_id = "telegram"
    display_name = "Telegram"
    auth_type = "token"

    def __init__(self, *, state_path: str = _DEFAULT_STATE_PATH) -> None:
        self._state_path = Path(state_path)
        self._status = SyncStatus()

    def _token(self) -> str:
        if self._state_path.exists():
            try:
                data = json.loads(self._state_path.read_text(encoding="utf-8"))
                if data.get("bot_token"):
                    return str(data["bot_token"])
            except Exception:
                pass
        return os.environ.get("TELEGRAM_BOT_TOKEN", "")

    def _load_state(self) -> Dict[str, Any]:
        if not self._state_path.exists():
            return {}
        try:
            return json.loads(self._state_path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save_state(self, state: Dict[str, Any]) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")

    def is_connected(self) -> bool:
        return bool(self._token())

    def disconnect(self) -> None:
        if self._state_path.exists():
            self._state_path.unlink()

    def sync(
        self, *, since: Optional[datetime] = None, cursor: Optional[str] = None
    ) -> Iterator[Document]:
        token = self._token()
        if not token:
            self._status.state = "error"
            self._status.error = "No Telegram bot token configured"
            return

        state = self._load_state()
        offset = int(state.get("update_offset", 0))

        data = _tg_get_updates(token, offset=offset)
        updates = data.get("result", []) if data.get("ok") else []
        max_seen = offset

        for upd in updates:
            update_id = int(upd.get("update_id", 0))
            if update_id >= max_seen:
                max_seen = update_id + 1

            msg = upd.get("message") or upd.get("edited_message")
            if not msg:
                continue
            text = msg.get("text") or msg.get("caption") or ""
            if not text:
                continue

            sender = msg.get("from", {}) or {}
            chat = msg.get("chat", {}) or {}
            sender_name = (
                f"{sender.get('first_name', '')} {sender.get('last_name', '')}".strip()
                or sender.get("username")
                or str(sender.get("id", ""))
            )
            ts_unix = msg.get("date")
            ts = datetime.fromtimestamp(ts_unix) if ts_unix else datetime.now()

            chat_label = (
                chat.get("title")
                or chat.get("username")
                or f"{chat.get('first_name', '')} {chat.get('last_name', '')}".strip()
                or str(chat.get("id", ""))
            )

            yield Document(
                doc_id=f"telegram-{chat.get('id', '')}-{msg.get('message_id', '')}",
                source="telegram",
                doc_type="message",
                content=text,
                title=f"{sender_name} → {chat_label}",
                author=sender_name,
                timestamp=ts,
                url=None,
                metadata={
                    "chat_id": chat.get("id"),
                    "chat_type": chat.get("type"),
                    "chat_title": chat_label,
                    "sender_id": sender.get("id"),
                    "message_id": msg.get("message_id"),
                },
            )

        # Persist next offset so we never re-fetch the same updates.
        new_state = {**state, "update_offset": max_seen}
        self._save_state(new_state)

        self._status.state = "idle"
        self._status.last_sync = datetime.now()

    def sync_status(self) -> SyncStatus:
        return self._status
