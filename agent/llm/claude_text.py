"""Tek metin-LLM yolu — Anthropic Agent SDK (abonelik kredisi).

Backend'in yan özellikleri (research özeti, inbox digest, calendar prep,
podcast senaryosu) eskiden ANTHROPIC_API_KEY ile api.anthropic.com çağırıyordu;
key purge'ünden beri ölüydüler. Artık hepsi bu modülden geçer — API key YOK
(CLAUDE_CODE_OAUTH_TOKEN / keychain login), anthropic_vision.py ile aynı desen.

Kullanım:
  from agent.llm.claude_text import complete
  text = await complete("Şunu özetle: ...")
"""

from __future__ import annotations

import os

from loguru import logger

try:
    import claude_agent_sdk as sdk

    _SDK_OK = True
except Exception:  # pragma: no cover
    _SDK_OK = False

# Yan görevler (özet/senaryo/brief) için varsayılan model — filo politikası
# sonnet-5; .env LLM_TEXT_MODEL ile ezilebilir.
TEXT_MODEL = os.getenv("LLM_TEXT_MODEL", "claude-sonnet-5")

_DEFAULT_SYSTEM = (
    "Sen XJarvis'in metin üretim modülüsün. Verilen görevi doğrudan yerine getir; "
    "tool çağırma, soru sorma, giriş cümlesi ekleme — sadece istenen çıktıyı yaz."
)


async def complete(
    prompt: str,
    *,
    system: str | None = None,
    model: str | None = None,
) -> str:
    """Tool'suz tek-tur metin tamamlama (abonelik kredisi) → düz metin.

    Hata durumunda "ERROR: ..." önekli string döner (çağıran ok/err ayırır);
    ham hata asla normal içerik gibi dönmez.
    """
    if not _SDK_OK:
        return "ERROR: claude_agent_sdk yok"
    prompt = (prompt or "").strip()
    if not prompt:
        return "ERROR: boş prompt"

    opts = sdk.ClaudeAgentOptions(
        model=model or TEXT_MODEL,
        system_prompt=system or _DEFAULT_SYSTEM,
        allowed_tools=[],
        disallowed_tools=["*"],
        setting_sources=[],
        max_turns=1,
        permission_mode="bypassPermissions",
    )

    out = ""
    try:
        async for m in sdk.query(prompt=prompt, options=opts):
            if isinstance(m, sdk.AssistantMessage):
                for b in m.content:
                    if isinstance(b, sdk.TextBlock) and b.text:
                        out += b.text
    except Exception as e:
        logger.error(f"[claude_text] SDK tamamlama hatası: {e}")
        return f"ERROR: {e}"
    return out.strip() or "ERROR: boş yanıt"
