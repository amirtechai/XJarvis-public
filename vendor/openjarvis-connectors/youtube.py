"""YouTube connector — liked videos and active subscriptions.

YouTube doesn't expose general watch history through the v3 API, so this
connector pulls the next-best signals: videos the user explicitly liked
and the channels they're subscribed to. Both end up in the knowledge store
where they can ground answers like "what was that AI talk I liked last
month" or "what new uploads happened on channels I follow".

Auth piggybacks on the shared Google OAuth flow (youtube.readonly scope).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

import httpx

from openjarvis.connectors._stubs import BaseConnector, Document, SyncStatus
from openjarvis.connectors.oauth import load_tokens, resolve_google_credentials
from openjarvis.core.config import DEFAULT_CONFIG_DIR
from openjarvis.core.registry import ConnectorRegistry

_YT_API_BASE = "https://youtube.googleapis.com/youtube/v3"
_DEFAULT_CREDENTIALS_PATH = str(DEFAULT_CONFIG_DIR / "connectors" / "youtube.json")


def _yt_api_get(
    token: str, endpoint: str, params: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Call a YouTube Data API v3 endpoint."""
    resp = httpx.get(
        f"{_YT_API_BASE}/{endpoint}",
        headers={"Authorization": f"Bearer {token}"},
        params=params or {},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


def _parse_iso(ts: str) -> datetime:
    if not ts:
        return datetime.now()
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now()


@ConnectorRegistry.register("youtube")
class YouTubeConnector(BaseConnector):
    """Sync liked videos and subscriptions from YouTube."""

    connector_id = "youtube"
    display_name = "YouTube"
    auth_type = "oauth"

    def __init__(self, *, credentials_path: str = "") -> None:
        self._credentials_path = Path(
            resolve_google_credentials(credentials_path or _DEFAULT_CREDENTIALS_PATH)
        )
        self._status = SyncStatus()

    def _get_access_token(self) -> str:
        tokens = load_tokens(str(self._credentials_path))
        return tokens.get("access_token") or tokens.get("token", "")

    def is_connected(self) -> bool:
        return self._credentials_path.exists()

    def disconnect(self) -> None:
        if self._credentials_path.exists():
            self._credentials_path.unlink()

    def sync(
        self, *, since: Optional[datetime] = None, cursor: Optional[str] = None
    ) -> Iterator[Document]:
        token = self._get_access_token()

        yield from self._sync_liked_videos(token)
        yield from self._sync_subscriptions(token)

        self._status.state = "idle"
        self._status.last_sync = datetime.now()

    def _sync_liked_videos(self, token: str) -> Iterator[Document]:
        data = _yt_api_get(
            token,
            "videos",
            params={
                "part": "snippet,statistics,contentDetails",
                "myRating": "like",
                "maxResults": "50",
            },
        )
        for item in data.get("items", []):
            snippet = item.get("snippet", {})
            stats = item.get("statistics", {})
            video_id = item.get("id", "")
            yield Document(
                doc_id=f"youtube-liked-{video_id}",
                source="youtube",
                doc_type="liked_video",
                content=snippet.get("description", "")[:2000],
                title=snippet.get("title", "Untitled video"),
                author=snippet.get("channelTitle", ""),
                timestamp=_parse_iso(snippet.get("publishedAt", "")),
                url=f"https://www.youtube.com/watch?v={video_id}" if video_id else None,
                metadata={
                    "video_id": video_id,
                    "channel_id": snippet.get("channelId", ""),
                    "channel_title": snippet.get("channelTitle", ""),
                    "tags": snippet.get("tags", []),
                    "view_count": stats.get("viewCount", "0"),
                    "like_count": stats.get("likeCount", "0"),
                    "duration": item.get("contentDetails", {}).get("duration", ""),
                },
            )

    def _sync_subscriptions(self, token: str) -> Iterator[Document]:
        page_token: Optional[str] = None
        for _ in range(5):  # cap at 5 pages = up to 250 channels
            params: Dict[str, str] = {
                "part": "snippet,contentDetails",
                "mine": "true",
                "maxResults": "50",
                "order": "alphabetical",
            }
            if page_token:
                params["pageToken"] = page_token
            data = _yt_api_get(token, "subscriptions", params=params)

            for item in data.get("items", []):
                snippet = item.get("snippet", {})
                resource = snippet.get("resourceId", {})
                content_details = item.get("contentDetails", {})
                channel_id = resource.get("channelId", "")
                yield Document(
                    doc_id=f"youtube-sub-{channel_id}",
                    source="youtube",
                    doc_type="subscription",
                    content=snippet.get("description", "")[:1500],
                    title=snippet.get("title", "Channel"),
                    author=snippet.get("title", ""),
                    timestamp=_parse_iso(snippet.get("publishedAt", "")),
                    url=f"https://www.youtube.com/channel/{channel_id}"
                    if channel_id
                    else None,
                    metadata={
                        "channel_id": channel_id,
                        "new_item_count": content_details.get("newItemCount", 0),
                        "total_item_count": content_details.get("totalItemCount", 0),
                    },
                )

            page_token = data.get("nextPageToken")
            if not page_token:
                break

    def sync_status(self) -> SyncStatus:
        return self._status
