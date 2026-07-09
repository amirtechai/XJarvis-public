"""Vision LLM analysis — Anthropic Agent SDK (abonelik kredisi).

Eskiden OpenRouter + Gemini Flash kullanıyordu; artık Claude'un görüntü
yeteneğini abonelik kredisiyle kullanıyor (API key YOK). Arayüz aynı kaldı
(VisionAnalyzer.analyze → AnalysisResult.to_dict) ki vision/service.py değişmesin.
"""

from __future__ import annotations

import base64
import hashlib
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from loguru import logger

# agent paketini import edebilmek için repo kökünü yola ekle.
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from agent.llm.anthropic_vision import analyze_image_json  # noqa: E402

DEFAULT_MODEL = os.getenv("VISION_MODEL_CLAUDE", "claude-haiku-4-5")
CACHE_TTL_S = 30.0


@dataclass
class AnalysisResult:
    objects: list[dict[str, Any]]
    text_visible: list[str]
    scene_description: str
    answer_to_query: str
    spatial_map: dict[str, str]
    raw: dict[str, Any]
    model: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "objects": self.objects,
            "text_visible": self.text_visible,
            "scene_description": self.scene_description,
            "answer_to_query": self.answer_to_query,
            "spatial_map": self.spatial_map,
            "model": self.model,
        }


class VisionAnalyzer:
    """Abonelik kredili görsel analiz. API key gerektirmez."""

    def __init__(self, api_key: str | None = None, model: str = DEFAULT_MODEL) -> None:
        self._model = model
        self._cache: dict[str, tuple[float, AnalysisResult]] = {}

    def _cache_key(self, image_b64: str, query: str) -> str:
        h = hashlib.sha256()
        h.update(query.encode())
        h.update(image_b64[:2000].encode())
        return h.hexdigest()

    def _check_cache(self, key: str) -> AnalysisResult | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        ts, result = entry
        if time.time() - ts > CACHE_TTL_S:
            self._cache.pop(key, None)
            return None
        return result

    async def analyze(
        self, image_b64: str, user_query: str = "Bu görselde ne var?"
    ) -> AnalysisResult:
        key = self._cache_key(image_b64, user_query)
        cached = self._check_cache(key)
        if cached is not None:
            logger.debug("[analyzer] cache hit")
            return cached

        image_bytes = base64.b64decode(image_b64)
        data = await analyze_image_json(image_bytes, user_query, suffix=".jpg")
        result = AnalysisResult(
            objects=data.get("objects", []),
            text_visible=data.get("text_visible", []),
            scene_description=data.get("scene_description", ""),
            answer_to_query=data.get("answer_to_query", ""),
            spatial_map=data.get("spatial_map", {}),
            raw=data,
            model=self._model,
        )
        self._cache[key] = (time.time(), result)
        return result
