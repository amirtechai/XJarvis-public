"""STT-based parallel wake-keyword scanner.

Runs alongside OpenWakeWord. Listens to the same audio bus and, on each
speech burst, runs a fast local whisper-cli pass on a short snapshot.
If the transcript starts with one of WAKE_KEYWORDS, fires the same
on_wake callback that OWW uses — capture preroll then re-transcribes
the full utterance.

Why: OpenWakeWord only supports pre-trained ONNX models, so arbitrary
keywords ("jarvis", "alex", "jaro", "jero", "fero") cannot be added
without custom training. This scanner gives us cheap, extensible
keyword spotting at the cost of ~400ms latency per check.

CPU is modest — whisper-cli runs on ~1.2s of audio with ggml-small,
~300-500ms on M-series. A 1.5s cooldown gates back-to-back fires.
"""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from typing import Awaitable, Callable

import numpy as np
from loguru import logger

from .audio import BLOCK_MS, SAMPLE_RATE, get_audio

WHISPER_BIN = os.getenv("WHISPER_CLI_BIN", "/opt/homebrew/bin/whisper-cli")
WHISPER_MODEL = os.getenv(
    "WHISPER_CLI_MODEL",
    str(Path.home() / ".cache" / "whisper-models" / "ggml-small.bin"),
)

# Keywords that should trigger listening when spoken at the start of an
# utterance. Match is case-insensitive and tolerant of trailing
# punctuation. Add more freely.
# Türkçe aksanla "Hey Jarvis" whisper'da çoğu zaman cervis/carvis/jervis gibi
# duyuluyor — varyantları ekledik. "servis" gerçek kelime → eklenmedi (false-fire).
DEFAULT_KEYWORDS = (
    "jarvis", "cervis", "carvis", "çarvis", "jervis", "carvis", "jarvis",
    "alex", "jaro", "jero",
)

# VAD / capture tunables
SPEECH_RMS_THRESHOLD = float(os.getenv("WAKE_KW_RMS", "0.012"))
SPEECH_HOLD_MS = int(os.getenv("WAKE_KW_HOLD_MS", "1200"))
COOLDOWN_S = float(os.getenv("WAKE_KW_COOLDOWN_S", "1.5"))
PREBUFFER_MS = int(os.getenv("WAKE_KW_PREBUFFER_MS", "400"))


def _pcm_to_wav(path: Path, pcm_bytes: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm_bytes)


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", text.lower()).strip()


class WakeKeywordScanner:
    def __init__(
        self,
        on_wake: Callable[[], Awaitable[None]],
        keywords: tuple[str, ...] = DEFAULT_KEYWORDS,
    ) -> None:
        self._on_wake = on_wake
        self._keywords = tuple(k.lower() for k in keywords)
        self._stop = asyncio.Event()
        self._enabled = True

    def disable(self) -> None:
        self._enabled = False

    def enable(self) -> None:
        self._enabled = True

    async def run(self) -> None:
        if not Path(WHISPER_BIN).exists():
            logger.warning(f"[wake-kw] whisper-cli not found at {WHISPER_BIN} — scanner disabled")
            return
        if not Path(WHISPER_MODEL).exists():
            logger.warning(f"[wake-kw] model not found at {WHISPER_MODEL} — scanner disabled")
            return

        logger.info(f"[wake-kw] ready — keywords={self._keywords}")

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=64)
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
        cooldown_until = 0.0
        prebuf_blocks = max(1, PREBUFFER_MS // BLOCK_MS)
        hold_blocks = max(1, SPEECH_HOLD_MS // BLOCK_MS)
        rolling: list[bytes] = []

        try:
            while not self._stop.is_set():
                try:
                    chunk = await asyncio.wait_for(queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue

                if not self._enabled:
                    continue

                rolling.append(chunk)
                if len(rolling) > prebuf_blocks:
                    rolling = rolling[-prebuf_blocks:]

                now = loop.time()
                if now < cooldown_until:
                    continue

                pcm_i16 = np.frombuffer(chunk, dtype=np.int16)
                f = pcm_i16.astype(np.float32) / 32768.0
                rms = float(np.sqrt(np.mean(f * f))) if len(f) else 0.0
                if rms < SPEECH_RMS_THRESHOLD:
                    continue

                # Speech detected — grab prebuffer + hold_blocks worth of audio
                burst = list(rolling)
                for _ in range(hold_blocks):
                    try:
                        c = await asyncio.wait_for(queue.get(), timeout=0.3)
                    except asyncio.TimeoutError:
                        break
                    burst.append(c)

                pcm_all = b"".join(burst)
                # Run whisper-cli off the event loop
                transcript = await loop.run_in_executor(None, self._run_whisper, pcm_all)
                if transcript:
                    norm = _normalize(transcript)
                    first_words = norm.split()[:3]
                    hit = next((kw for kw in self._keywords if kw in first_words), None)
                    if hit:
                        logger.info(f"[wake-kw] FIRED on {hit!r} — transcript={transcript!r}")
                        cooldown_until = now + COOLDOWN_S
                        try:
                            await self._on_wake()
                        except Exception as e:
                            logger.error(f"[wake-kw] callback failed: {e}")
                    else:
                        logger.debug(f"[wake-kw] no match — {transcript!r}")

                # Always enforce a small cooldown after a check, even on miss,
                # so we don't pile up whisper calls during continuous speech.
                cooldown_until = max(cooldown_until, loop.time() + 0.6)
        finally:
            audio.unsubscribe(sub_id)

    def _run_whisper(self, pcm_bytes: bytes) -> str:
        try:
            with tempfile.TemporaryDirectory() as td:
                wav_path = Path(td) / "burst.wav"
                _pcm_to_wav(wav_path, pcm_bytes)
                out_base = Path(td) / "out"
                proc = subprocess.run(
                    [
                        WHISPER_BIN,
                        "-m", WHISPER_MODEL,
                        "-f", str(wav_path),
                        "-l", "auto",
                        "-nt",          # no timestamps
                        "-otxt",
                        "-of", str(out_base),
                        "-t", "4",      # threads
                    ],
                    capture_output=True,
                    text=True,
                    timeout=4.0,
                )
                if proc.returncode != 0:
                    logger.debug(f"[wake-kw] whisper rc={proc.returncode} stderr={proc.stderr[:200]}")
                    return ""
                txt_path = out_base.with_suffix(".txt")
                if not txt_path.exists():
                    return ""
                return txt_path.read_text(encoding="utf-8").strip()
        except subprocess.TimeoutExpired:
            logger.debug("[wake-kw] whisper timeout")
            return ""
        except Exception as e:
            logger.debug(f"[wake-kw] whisper err: {e}")
            return ""

    def stop(self) -> None:
        self._stop.set()
