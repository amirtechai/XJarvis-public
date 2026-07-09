"""XJarvis agent configuration — env-driven, no hard-coded secrets."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")


PROVIDER_ENDPOINTS = {
    # ollama: local M4 Max — sınırsız, ücretsiz, hızlı (~80 tok/s)
    "ollama": "http://localhost:11434/v1/chat/completions",
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "together": "https://api.together.xyz/v1/chat/completions",
    # claude: Claude aboneligi / Agent SDK (CLAUDE_CODE_OAUTH_TOKEN ya da Mac keychain login). API key YOK.
    "claude": "sdk://subscription",
}

PROVIDER_DEFAULTS = {
    # ollama: yerel, sınırsız. gpt-oss:20b cloud Groq versiyonuyla aynı model.
    "ollama": ("gpt-oss:20b", "gpt-oss:20b", "qwen3.5-32k:latest"),
    # groq: ücretsiz cloud, TPM 8K dar — only as fallback.
    "groq": ("openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.1-8b-instant"),
    "gemini": ("gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"),
    # together: birincil sağlayıcı. Llama-3.3-70B-Turbo ~1.8s + sağlam tool-calling.
    "together": (
        "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "Qwen/Qwen2.5-7B-Instruct-Turbo",
    ),
    # claude: ust model varsayilan. default=sonnet, heavy=opus, free=haiku. Abonelik kredisi.
    "claude": ("claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"),
}


@dataclass(frozen=True)
class AgentConfig:
    api_key: str
    endpoint_url: str
    provider: str
    model_default: str
    model_heavy: str
    model_free: str
    daily_cap_usd: float
    port: int
    max_iter: int
    site_url: str
    app_name: str

    @classmethod
    def load(cls) -> "AgentConfig":
        provider = (os.getenv("LLM_PROVIDER") or "ollama").strip().lower()
        if provider not in PROVIDER_ENDPOINTS:
            raise RuntimeError(
                f"Unknown LLM_PROVIDER='{provider}'. "
                f"Valid: {', '.join(PROVIDER_ENDPOINTS)}"
            )
        key_env_map = {
            "ollama": None,  # local — no auth needed
            "groq": "GROQ_API_KEY",
            "gemini": "GEMINI_API_KEY",
            "together": "TOGETHER_API_KEY",
            "claude": None,  # SDK auth (OAuth token / keychain), API key yok
        }
        key_env = key_env_map[provider]
        if key_env is None:
            key = "ollama"  # dummy bearer; Ollama ignores Authorization
        else:
            key = (os.getenv(key_env) or "").strip()
            if not key:
                # OpenRouter artık kullanılmıyor — fallback zincirinden çıkarıldı.
                key = (
                    os.getenv("TOGETHER_API_KEY")
                    or os.getenv("GROQ_API_KEY")
                    or os.getenv("GEMINI_API_KEY")
                    or ""
                ).strip()
            if not key:
                raise RuntimeError(f"{key_env} missing in backend/.env")

        d_default, d_heavy, d_free = PROVIDER_DEFAULTS[provider]
        return cls(
            api_key=key,
            endpoint_url=PROVIDER_ENDPOINTS[provider],
            provider=provider,
            model_default=os.getenv("LLM_DEFAULT", d_default),
            model_heavy=os.getenv("LLM_HEAVY", d_heavy),
            model_free=os.getenv("LLM_FREE", d_free),
            daily_cap_usd=float(os.getenv("LLM_DAILY_CAP_USD", "2.00")),
            port=int(os.getenv("AGENT_PORT", "8767")),
            max_iter=int(os.getenv("AGENT_MAX_ITER", "8")),
            site_url=os.getenv(
                "XJARVIS_SITE_URL", "https://github.com/amirtechai/XJarvis-public"
            ),
            app_name=os.getenv("XJARVIS_APP_NAME", "XJarvis"),
        )
