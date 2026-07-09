"""Tek görsel-analiz yolu — Anthropic Agent SDK (abonelik kredisi).

OpenRouter/Gemini yerine Claude'un görüntü yeteneğini abonelik kredisiyle
kullanır (API key YOK; CLAUDE_CODE_OAUTH_TOKEN / keychain login). SDK base64
content-block'u kabul etmediğinden görüntüyü geçici dosyaya yazıp Read tool'u
ile açtırırız (Claude Code'un yerel görüntü yolu).

Kullanım:
  from agent.llm.anthropic_vision import analyze_image, analyze_image_file
  text = await analyze_image(jpeg_bytes, "Önümde ne var?")
  data = await analyze_image_json(jpeg_bytes, query)   # şemalı JSON ister
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import uuid
from pathlib import Path

from loguru import logger

try:
    import claude_agent_sdk as sdk

    _SDK_OK = True
except Exception:  # pragma: no cover
    _SDK_OK = False

# Görsel analiz için hızlı + ucuz model (abonelik kredisi).
VISION_MODEL = os.getenv("VISION_MODEL_CLAUDE", "claude-haiku-4-5")
_READ_ONLY_DISALLOWED = [
    "Bash",
    "Edit",
    "Write",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "Task",
    "TodoWrite",
    "NotebookEdit",
    "BashOutput",
    "KillShell",
    "ExitPlanMode",
]


async def analyze_image_file(
    path: str,
    query: str = "Bu görselde ne var? Türkçe, kısa.",
    *,
    model: str | None = None,
) -> str:
    """Diskteki bir görseli abonelik kredili Claude ile analiz et → düz metin."""
    if not _SDK_OK:
        return "ERROR: claude_agent_sdk yok"
    if not Path(path).exists():
        return f"ERROR: dosya yok: {path}"

    opts = sdk.ClaudeAgentOptions(
        model=model or VISION_MODEL,
        system_prompt=(
            "Sen XJarvis'in görsel analiz modülüsün. Verilen görsel dosyasını Read "
            "ile aç, soruyu Türkçe ve KISA yanıtla. Marka/yazı/nesne ilişkilerini not et."
        ),
        allowed_tools=["Read"],
        disallowed_tools=_READ_ONLY_DISALLOWED,
        setting_sources=[],
        max_turns=4,
        permission_mode="bypassPermissions",
    )

    async def _prompt():
        yield {
            "type": "user",
            "message": {
                "role": "user",
                "content": f"{path} görselini Read ile aç. Soru: {query}",
            },
        }

    out = ""
    try:
        async for m in sdk.query(prompt=_prompt(), options=opts):
            if isinstance(m, sdk.AssistantMessage):
                for b in m.content:
                    if isinstance(b, sdk.TextBlock) and b.text:
                        out += b.text
    except Exception as e:
        logger.error(f"[vision] SDK analiz hatası: {e}")
        return f"ERROR: {e}"
    return out.strip() or "(boş yanıt)"


async def analyze_image(
    image_bytes: bytes,
    query: str = "Bu görselde ne var? Türkçe, kısa.",
    *,
    suffix: str = ".jpg",
    model: str | None = None,
) -> str:
    """Bellekteki görsel byte'larını geçici dosyaya yazıp analiz et → düz metin."""
    tmp = Path(tempfile.gettempdir()) / f"xjarvis_vis_{uuid.uuid4().hex}{suffix}"
    try:
        tmp.write_bytes(image_bytes)
        return await analyze_image_file(str(tmp), query, model=model)
    finally:
        try:
            tmp.unlink()
        except Exception:
            pass


_JSON_INSTRUCT = (
    " Yanıtı SADECE şu JSON şemasında ver (markdown/```​ yok): "
    '{"objects":[{"name":str,"position":str}],"text_visible":[str],'
    '"scene_description":str,"answer_to_query":str}'
)


def _strip_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[-1]
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
    return s.strip()


async def analyze_image_json(
    image_bytes: bytes, query: str = "Bu görselde ne var?", *, suffix: str = ".jpg"
) -> dict:
    """Şemalı JSON döndüren vision analizi (eski OpenRouter analyzer'ın yerini tutar)."""
    raw = await analyze_image(image_bytes, query + _JSON_INSTRUCT, suffix=suffix)
    if raw.startswith("ERROR:"):
        return {
            "answer_to_query": raw,
            "objects": [],
            "text_visible": [],
            "scene_description": raw,
        }
    try:
        data = json.loads(_strip_fences(raw))
        data.setdefault("objects", [])
        data.setdefault("text_visible", [])
        data.setdefault("scene_description", data.get("answer_to_query", ""))
        data.setdefault("answer_to_query", raw)
        return data
    except json.JSONDecodeError:
        # Model düz metin döndüyse onu cevap olarak sar.
        return {
            "objects": [],
            "text_visible": [],
            "scene_description": raw,
            "answer_to_query": raw,
        }
