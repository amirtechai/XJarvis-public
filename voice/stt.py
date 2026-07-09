"""Utterance capture + batch STT via OpenAI gpt-4o-mini-transcribe.

Flow when wake fires:
  1. Drain pre-roll (last ~2s before wake) into recording buffer
  2. Listen live; track RMS to find speech start, then end (~1s silence)
  3. Stop on speech-end OR MAX_UTTERANCE_S
  4. POST WAV to OpenAI → transcript
  5. Return text, never partial-vs-final dance.

Reliable, deterministic, no streaming quirks.
"""

from __future__ import annotations

import asyncio
import io
import os
import re
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from typing import Optional

import aiohttp
import numpy as np
from loguru import logger
from openai import AsyncOpenAI

from .audio import BLOCK_MS, SAMPLE_RATE, get_audio

# Tunables
SPEECH_RMS_THRESHOLD = float(os.getenv("STT_SPEECH_RMS", "0.018"))
# Konuşma sayılması için gereken SÜREKLI ses (ms). Tek gürültü chunk'ı (kapı,
# tıklama, ortam) konuşma sanılmasın → eller-serbest çevresel sese cevap yazmasın.
MIN_VOICED_MS = float(os.getenv("STT_MIN_VOICED_MS", "200"))
SPEECH_START_MS = int(os.getenv("STT_SPEECH_START_MS", "180"))
SILENCE_END_MS = int(os.getenv("STT_SILENCE_END_MS", "900"))
MAX_UTTERANCE_S = float(os.getenv("STT_MAX_UTTERANCE_S", "8.0"))
NO_SPEECH_ABORT_S = float(os.getenv("STT_NO_SPEECH_ABORT_S", "3.5"))
LANGUAGE = os.getenv("XJARVIS_LANG", "en")
STT_MODEL = os.getenv("STT_MODEL", "gpt-4o-mini-transcribe")

# Yerel whisper-cli (whisper.cpp) — VARSAYILAN STT. Ücretsiz, offline, hızlı
# (M-series ~0.3-0.8s ggml-small). Cloud backend'ler (deepgram/groq/openai)
# sadece fallback. Kapatmak için STT_LOCAL_WHISPER=0.
WHISPER_CLI_BIN = os.getenv("WHISPER_CLI_BIN", "/opt/homebrew/bin/whisper-cli")
WHISPER_CLI_MODEL = os.getenv(
    "WHISPER_CLI_MODEL",
    str(Path.home() / ".cache" / "whisper-models" / "ggml-small.bin"),
)
LOCAL_WHISPER_ENABLED = os.getenv("STT_LOCAL_WHISPER", "1") not in (
    "0",
    "false",
    "False",
)

# Prompt-bias vocabulary — XJarvis-specific Turkish command words. Whisper
# uses `prompt` as conditioning context; Deepgram uses `keywords` to boost
# acoustic weights for these terms. Helps short Turkish commands like
# "multi tv aç" not get mis-heard as "Multi TV yaşam" (real failure mode).
# Add freely — terms here should be either page slugs, action verbs, or
# names XJarvis is expected to recognise.
WAKE_NAMES = ["Jarvis", "Jaro", "Jero", "Fero", "Gero", "Alex"]
PAGE_NAMES = [
    "multi tv",
    "çoklu tv",
    "tv duvarı",
    "youtube",
    "dashboard",
    "orbital",
    "ana ekran",
    "ana sayfa",
    "haberler",
    "news",
    "world watch",
    "dünya",
    "trading",
    "borsa",
    "kripto",
    "binance",
    "takvim",
    "calendar",
    "ajanda",
    "inbox",
    "gelen kutusu",
    "mailler",
    "hedefler",
    "goals",
    "podcast",
    "whiteboard",
    "beyaz tahta",
    "tools",
    "araçlar",
    "agents",
    "ajanlar",
    "ayarlar",
    "settings",
    "preferences",
    "knowledge",
    "kgraph",
    "bilgi grafiği",
    "brief",
    "brifing",
    "günün özeti",
    "research",
    "araştırma",
    "design",
    "tasarım",
    "creative",
    "yaratıcı",
    "history",
    "geçmiş",
    "logs",
    "loglar",
    "kayıtlar",
    "health",
    "sağlık",
    "whoop",
    "uyku",
    "crashes",
    "çökmeler",
    "hatalar",
    "costs",
    "maliyet",
    "harcama",
    "replay",
    "yeniden oynat",
    "notion",
    "obsidian",
    "linear",
    "jira",
    "github",
    "spotify",
    "müzik",
    "şarkı",
    "drafts",
    "taslaklar",
    "dictation",
    "dikte",
    "quick capture",
    "hızlı kayıt",
    "not al",
    "connectors",
    "bağlantılar",
    "workflows",
    "iş akışları",
    "otomasyon",
    "remote",
    "uzak",
    "companion",
    "cyber",
    "siber",
    "güvenlik",
    "chat",
    "sohbet",
]
ACTION_VERBS = [
    "aç",
    "açar mısın",
    "açıver",
    "kapat",
    "kapatır mısın",
    "göster",
    "göstersene",
    "getir",
    "geç",
    "git",
    "yönlendir",
    "başlat",
    "durdur",
    "duraklat",
    "devam et",
    "söyle",
    "anlat",
    "özetle",
    "oku",
    "yaz",
    "kaydet",
    "ara",
    "bul",
    "tara",
    "ileri",
    "geri",
    "sonraki",
    "önceki",
    "sessize al",
    "sesi aç",
    "ses kıs",
    "ses artır",
]
PROMPT_BIAS = (
    "XJarvis sesli komut: " + ", ".join(WAKE_NAMES + PAGE_NAMES + ACTION_VERBS) + "."
)
# Deepgram keyword param has a length limit; cap to first ~40 most-useful.
DEEPGRAM_KEYWORDS = WAKE_NAMES + PAGE_NAMES[:30] + ACTION_VERBS[:10]


def _pcm_to_wav(pcm_bytes: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm_bytes)
    return buf.getvalue()


def _rms(pcm_i16: np.ndarray) -> float:
    if len(pcm_i16) == 0:
        return 0.0
    f = pcm_i16.astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(f * f)))


async def capture_utterance(
    on_partial=None,
    no_speech_abort_s: float | None = None,
    max_utterance_s: float | None = None,
    silence_end_ms: int | None = None,
    on_amplitude=None,
) -> bytes:
    """Block until utterance is captured, return raw int16 PCM bytes (or empty)."""
    abort_s = no_speech_abort_s if no_speech_abort_s is not None else NO_SPEECH_ABORT_S
    max_utt = max_utterance_s if max_utterance_s is not None else MAX_UTTERANCE_S
    silence_ms = silence_end_ms if silence_end_ms is not None else SILENCE_END_MS
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=128)
    audio = get_audio()

    def push(pcm: bytes) -> None:
        def _put() -> None:
            try:
                queue.put_nowait(pcm)
            except asyncio.QueueFull:
                pass

        try:
            loop.call_soon_threadsafe(_put)
        except RuntimeError:
            pass

    sub_id = audio.subscribe(push)
    try:
        # Start with preroll so words said BEFORE wake are not lost
        chunks: list[bytes] = []
        preroll = audio.get_preroll()
        if preroll:
            chunks.append(preroll)

        started = time.time()
        speech_started = False
        speech_at = 0.0
        last_loud_at = 0.0
        voiced_run = 0.0  # ardışık ses süresi (ms) — sürekli ses olmadan konuşma sayma

        while True:
            elapsed = time.time() - started
            if elapsed > max_utt:
                logger.info("[stt] max utterance reached")
                break

            try:
                chunk = await asyncio.wait_for(queue.get(), timeout=0.2)
            except asyncio.TimeoutError:
                # No-speech abort
                if not speech_started and elapsed > abort_s:
                    logger.info("[stt] no speech — aborting")
                    chunks = []
                    break
                continue

            chunks.append(chunk)
            now = time.time()
            pcm_i16 = np.frombuffer(chunk, dtype=np.int16)
            rms = _rms(pcm_i16)
            if on_amplitude:
                on_amplitude(rms)  # canlı tepki: avatar sesinle nabız atsın

            if rms > SPEECH_RMS_THRESHOLD:
                last_loud_at = now
                voiced_run += BLOCK_MS
                # SÜREKLI ses (≥MIN_VOICED_MS) olmadan konuşma sayma → tek gürültü
                # patlaması (kapı, tıklama, ortam) yanlış tetikleme yapmaz.
                if (
                    not speech_started
                    and voiced_run >= MIN_VOICED_MS
                    and (now - started) > 0.05
                ):
                    speech_started = True
                    speech_at = now
                    if on_partial:
                        on_partial("…")
            else:
                if not speech_started:
                    voiced_run = 0.0  # ardışık ses kesildi → transient gürültü, sıfırla
                elif (now - last_loud_at) * 1000 > silence_ms:
                    # Konuşma bittikten sonra sessizlik → bitir
                    logger.info(
                        f"[stt] speech ended ({(now - speech_at) * 1000:.0f}ms voice)"
                    )
                    break

            # Without ever seeing loud speech, abort
            if not speech_started and elapsed > abort_s:
                logger.info("[stt] no speech detected — aborting")
                chunks = []
                break

        return b"".join(chunks) if speech_started else b""
    finally:
        audio.unsubscribe(sub_id)


# Sessizlik/gurultuden Whisper'in urettigi "akici ama anlamsiz" halusinasyonu
# METIN tekrarindan yakalayamayiz (tekrarsiz olabiliyor). Groq verbose_json'un
# segment guven sinyalleri (no_speech_prob / avg_logprob) tek gecerli kapi.
# Bu sentinel'i goren transcribe() sesi cöp sayar ve fallback DENEMEZ (Groq
# birincil + en iyi Turkce; o dusuk-guven dediyse ses gercekten gurultu).
_LOW_CONF = "\x00LOWCONF"
STT_NO_SPEECH_MAX = float(os.getenv("STT_NO_SPEECH_MAX", "0.72"))
STT_AVG_LOGPROB_MIN = float(os.getenv("STT_AVG_LOGPROB_MIN", "-1.15"))


async def _transcribe_groq(wav_bytes: bytes) -> Optional[str]:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return None
    form = aiohttp.FormData()
    form.add_field("file", wav_bytes, filename="utt.wav", content_type="audio/wav")
    form.add_field("model", os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo"))
    form.add_field("language", LANGUAGE)
    # verbose_json → metin + segment guven sinyalleri (no_speech_prob/avg_logprob).
    form.add_field("response_format", "verbose_json")
    # whisper-large-v3 Türkçe'de zaten mükemmel; uzun prompt-bias gereksizdi ve
    # Groq'un 896 BAYT limitini (Türkçe çok-baytlı karakterler) aşıp 400 veriyordu.
    # Kısa, baytı sınırlı bir bias kullan.
    short_bias = "XJarvis sesli komut: Jarvis, Spotify, aç, kapat, göster, çal, sesi kıs, haberler."
    form.add_field("prompt", short_bias)
    form.add_field(
        "temperature", "0"
    )  # deterministik decode → Türkçe'de daha az halüsinasyon
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
            async with s.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "User-Agent": "xjarvis/1.0",
                },
                data=form,
            ) as r:
                if r.status != 200:
                    logger.warning(f"[stt/groq] {r.status}: {(await r.text())[:200]}")
                    return None
                try:
                    raw = await r.json()
                except Exception:
                    # verbose_json beklenmiyorsa (ör. proxy) düz metne düş.
                    return (await r.text()).strip()
    except Exception as e:
        logger.warning(f"[stt/groq] err: {e}")
        return None

    text = (raw.get("text") or "").strip() if isinstance(raw, dict) else ""
    if not text:
        return None
    segs = raw.get("segments") or []
    nsp = [
        s.get("no_speech_prob")
        for s in segs
        if isinstance(s.get("no_speech_prob"), (int, float))
    ]
    alp = [
        s.get("avg_logprob")
        for s in segs
        if isinstance(s.get("avg_logprob"), (int, float))
    ]
    if nsp and alp:
        mean_nsp = sum(nsp) / len(nsp)
        mean_alp = sum(alp) / len(alp)
        if mean_nsp > STT_NO_SPEECH_MAX or mean_alp < STT_AVG_LOGPROB_MIN:
            logger.info(
                f"[stt/groq] düşük güven (no_speech={mean_nsp:.2f} "
                f"logprob={mean_alp:.2f}) → gürültü sayıldı: {text!r}"
            )
            return _LOW_CONF
    return text


async def _transcribe_deepgram(wav_bytes: bytes) -> Optional[str]:
    api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
    if not api_key:
        return None
    from urllib.parse import quote

    # nova-3 'keywords' yerine 'keyterm' istiyor (eski 'keywords' → 400).
    kw_params = "".join(f"&keyterm={quote(k)}" for k in DEEPGRAM_KEYWORDS)
    params = (
        f"model=nova-3&language={LANGUAGE}&smart_format=true&punctuate=true{kw_params}"
    )
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
            async with s.post(
                f"https://api.deepgram.com/v1/listen?{params}",
                headers={
                    "Authorization": f"Token {api_key}",
                    "Content-Type": "audio/wav",
                },
                data=wav_bytes,
            ) as r:
                if r.status != 200:
                    logger.warning(
                        f"[stt/deepgram] {r.status}: {(await r.text())[:200]}"
                    )
                    return None
                j = await r.json()
                alt = (
                    j.get("results", {})
                    .get("channels", [{}])[0]
                    .get("alternatives", [{}])[0]
                )
                return (alt.get("transcript") or "").strip()
    except Exception as e:
        logger.warning(f"[stt/deepgram] err: {e}")
        return None


async def _transcribe_openai(wav_bytes: bytes) -> Optional[str]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    client = AsyncOpenAI(api_key=api_key)
    try:
        resp = await client.audio.transcriptions.create(
            model=STT_MODEL,
            file=("utt.wav", wav_bytes, "audio/wav"),
            language=LANGUAGE,
            response_format="text",
            prompt=PROMPT_BIAS,
        )
        return (resp if isinstance(resp, str) else getattr(resp, "text", "")).strip()
    except Exception as e:
        logger.warning(f"[stt/openai] err: {e}")
        return None


def _run_whisper_cli_sync(wav_bytes: bytes) -> Optional[str]:
    if not Path(WHISPER_CLI_BIN).exists() or not Path(WHISPER_CLI_MODEL).exists():
        return None
    try:
        with tempfile.TemporaryDirectory() as td:
            wav_path = Path(td) / "utt.wav"
            wav_path.write_bytes(wav_bytes)
            out_base = Path(td) / "out"
            proc = subprocess.run(
                [
                    WHISPER_CLI_BIN,
                    "-m",
                    WHISPER_CLI_MODEL,
                    "-f",
                    str(wav_path),
                    "-l",
                    LANGUAGE,
                    "-nt",
                    "-otxt",
                    "-of",
                    str(out_base),
                    "-t",
                    "4",
                ],
                capture_output=True,
                text=True,
                timeout=15.0,
            )
            if proc.returncode != 0:
                logger.warning(
                    f"[stt/local] whisper rc={proc.returncode} {proc.stderr[:160]}"
                )
                return None
            txt = out_base.with_suffix(".txt")
            return txt.read_text(encoding="utf-8").strip() if txt.exists() else None
    except subprocess.TimeoutExpired:
        logger.warning("[stt/local] whisper timeout")
        return None
    except Exception as e:
        logger.warning(f"[stt/local] err: {e}")
        return None


async def _transcribe_local_whisper(wav_bytes: bytes) -> Optional[str]:
    if not LOCAL_WHISPER_ENABLED:
        return None
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _run_whisper_cli_sync, wav_bytes)


async def transcribe(pcm_bytes: bytes) -> str:
    """Transcribe with cascading fallback: Groq → local → Deepgram → OpenAI.

    Groq whisper-large-v3-turbo BİRİNCİL (ücretsiz, ~0.4s, kusursuz Türkçe).
    Yerel ggml-small sadece offline fallback (Türkçesi zayıf: "Jarvis"→"Cervis").
    Her backend'in timeout koruması vardır.
    """
    if not pcm_bytes:
        return ""
    wav = _pcm_to_wav(pcm_bytes)
    # Fallback chain: Groq birincil (en doğru Türkçe), lokal offline yedek,
    # sonra Deepgram, OpenAI. Her backend per-backend timeout'lu.
    for fn, name, timeout_s in (
        (_transcribe_groq, "groq", 15.0),  # whisper-large-v3-turbo: ~0.3s
        (_transcribe_local_whisper, "local", 15.0),  # ggml-small: offline yedek
        (_transcribe_deepgram, "deepgram", 15.0),
        (_transcribe_openai, "openai", 15.0),
    ):
        try:
            text = await asyncio.wait_for(fn(wav), timeout=timeout_s)
            if text == _LOW_CONF:
                # Groq güven-kapısı sesi gürültü saydı → fallback deneme, boş dön.
                logger.info(f"[stt] {name}: düşük güven, ses gürültü sayıldı")
                return ""
            if text:
                logger.info(f"[stt] {name} → {text!r}")
                return text
        except asyncio.TimeoutError:
            logger.warning(f"[stt] {name} timeout (>{timeout_s}s); trying next")
        except Exception as e:
            logger.warning(f"[stt] {name} error; trying next: {e}")
    logger.error("[stt] all backends failed")
    return ""


_GARBAGE_CHARS = set(". …·-_")


_HALLUCINATION_PATTERNS = {
    "altyazı m.k.",
    "altyazi m.k.",
    "altyazı: m.k.",
    "altyazı m.k",
    "altyazı m. k.",
    "alt yazı m.k.",
    "abone ol",
    "abone olmayı unutmayın",
    "kanalıma abone ol",
    "izlediğiniz için teşekkürler",
    "izlediğiniz için teşekkür ederim",
    "teşekkürler",
    "thanks for watching",
    "thank you for watching",
    "please subscribe",
    "subscribe to my channel",
    "altyazı m.k. tarafından hazırlanmıştır",
}


def _normalize_clause(c: str) -> str:
    return c.lower().strip(" \t.!?,:;\"'…-").strip()


def _looks_repetitive(words: list[str]) -> bool:
    """Whisper'in gurultu/medya-sizinti halusinasyonu = ayni cumleyi/n-gram'i
    tekrarlar ( or. 'Ruzgarlar arka kadar sistirelim. O, ruzgarlar arka kadar
    sistirelim.'). Tekil kisa onaylari (Tamam, tamam) korur."""
    n = len(words)
    if n < 6:
        return False
    # Herhangi bir 4-kelimelik obek 2+ kez tekrarliyorsa → halusinasyon
    # (gercek konusmada tam 4-gram tekrari cok nadir).
    if n >= 8:
        quad = [" ".join(words[i : i + 4]) for i in range(n - 3)]
        if len(quad) != len(set(quad)):
            return True
    # 3-gram tekrar orani: cok sayida ayni 3'lu pencere → halusinasyon
    grams = [" ".join(words[i : i + 3]) for i in range(n - 2)]
    if grams:
        uniq_ratio = len(set(grams)) / len(grams)
        if uniq_ratio <= 0.6:
            return True
    # Tekli kelime cesitliligi cok dusukse (uzun ama az farkli kelime)
    if n >= 8 and len(set(words)) / n <= 0.5:
        return True
    return False


def _is_garbage(text: str) -> bool:
    s = (text or "").strip()
    if len(s) < 3:
        return True
    # Only punctuation / dots / dashes (Whisper's "no-speech" signature)
    if all(ch in _GARBAGE_CHARS or ch.isspace() for ch in s):
        return True
    # Single repeated token like "you you you" or "..."
    words = s.lower().split()
    if len(words) >= 2 and len(set(words)) == 1:
        return True
    # Repeated-phrase / low-diversity hallucination (medya sesi sizintisi)
    if _looks_repetitive(words):
        return True
    # Ayni cumle/clause 2+ kez tekrarliyorsa (noktalama-ayirmali)
    clauses = [
        _normalize_clause(c)
        for c in re.split(r"[.!?]+", s)
        if len(_normalize_clause(c)) >= 4
    ]
    if len(clauses) >= 2 and len(set(clauses)) < len(clauses):
        return True
    # Whisper Turkish silence-hallucinations (subtitle / outro artifacts)
    low = s.lower().strip(" .!?,:;\"'")
    if low in _HALLUCINATION_PATTERNS:
        return True
    for pat in _HALLUCINATION_PATTERNS:
        if pat in low and len(low) < len(pat) + 12:
            return True
    return False


# Konusuldu ama anlasilmadi (garbage/dusuk-guven) — gercek sessizlikten (bos "")
# FARKLI. Caller bunu gorup kullaniciya "net duyamadim" geri bildirimi verir.
UNCLEAR = "\x00UNCLEAR"


async def capture_and_transcribe(
    on_partial=None,
    no_speech_abort_s: float | None = None,
    max_utterance_s: float | None = None,
    silence_end_ms: int | None = None,
    on_amplitude=None,
) -> str:
    pcm = await capture_utterance(
        on_partial=on_partial,
        no_speech_abort_s=no_speech_abort_s,
        max_utterance_s=max_utterance_s,
        silence_end_ms=silence_end_ms,
        on_amplitude=on_amplitude,
    )
    if not pcm:
        return ""  # gercek sessizlik → sessizce gec
    text = await transcribe(pcm)
    if _is_garbage(text):
        logger.info(f"[stt] dropped garbage transcript: {text!r}")
        return UNCLEAR  # ses vardi ama anlasilmadi → caller geri bildirim versin
    logger.info(f"[stt] transcript: {text!r}")
    return text
