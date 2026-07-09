"""Wake-word detection with OpenWakeWord (hey_jarvis).

Pre-trained ONNX model — no whisper hallucinations, no false fires on TV.
Score threshold tunable via WAKE_THRESHOLD (default 0.5). Score is per-block;
we trigger on first crossing then enforce a cooldown.
"""
from __future__ import annotations

import asyncio
import os
from typing import Awaitable, Callable

import numpy as np
from loguru import logger

from .audio import BLOCK_SAMPLES, get_audio

DEFAULT_THRESHOLD = float(os.getenv("WAKE_THRESHOLD", "0.5"))
DEFAULT_COOLDOWN = 1.5


class WakeDetector:
    def __init__(
        self,
        on_wake: Callable[[], Awaitable[None]],
        threshold: float = DEFAULT_THRESHOLD,
        cooldown_s: float = DEFAULT_COOLDOWN,
    ) -> None:
        self._on_wake = on_wake
        self._threshold = threshold
        self._cooldown_s = cooldown_s
        self._stop = asyncio.Event()
        self._model = None
        self._enabled = True

    def disable(self) -> None:
        self._enabled = False

    def enable(self) -> None:
        self._enabled = True

    async def run(self) -> None:
        try:
            from openwakeword.model import Model
        except ImportError:
            logger.error("[wake] openwakeword not installed — pip install openwakeword")
            return

        try:
            self._model = Model(wakeword_models=["hey_jarvis_v0.1"], inference_framework="onnx")
            logger.info(f"[wake] OpenWakeWord ready — hey_jarvis (threshold={self._threshold})")
        except Exception as e:
            logger.error(f"[wake] model load failed: {e}")
            return

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
        frames_seen = 0
        peak_score = 0.0
        last_heartbeat = loop.time()
        muted_was = False

        try:
            while not self._stop.is_set():
                try:
                    chunk = await asyncio.wait_for(queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue

                if not self._enabled:
                    continue

                # If audio bus is currently muted (TTS playing), drain stale
                # frames so we don't process the last block from before mute.
                if audio._muted:  # noqa: SLF001
                    muted_was = True
                    # Reset OWW internal state so old context can't carry
                    # across the silence gap and trigger after unmute.
                    try:
                        self._model.reset()
                    except Exception:
                        pass
                    continue

                now = loop.time()
                if muted_was:
                    # Audio just resumed — enforce a settle cooldown so any
                    # speaker tail / TTS reverberation can't trigger wake.
                    muted_was = False
                    cooldown_until = now + self._cooldown_s
                    # Flush whatever is queued from the transition.
                    while not queue.empty():
                        try:
                            queue.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                    continue
                if now < cooldown_until:
                    continue

                pcm_i16 = np.frombuffer(chunk, dtype=np.int16)
                if len(pcm_i16) != BLOCK_SAMPLES:
                    logger.warning(f"[wake] block size mismatch: {len(pcm_i16)} != {BLOCK_SAMPLES}")
                    continue

                try:
                    scores = self._model.predict(pcm_i16)
                except Exception as e:
                    logger.warning(f"[wake] predict err: {e}")
                    continue

                top = max(scores.values()) if scores else 0.0
                frames_seen += 1
                if top > peak_score:
                    peak_score = top

                # Heartbeat every 5s — confirms OWW is alive + shows peak score
                if now - last_heartbeat > 5.0:
                    rms = float(np.sqrt(np.mean((pcm_i16.astype(np.float32) / 32768.0) ** 2)))
                    logger.info(f"[wake] heartbeat — frames={frames_seen} peak_score={peak_score:.3f} mic_rms={rms:.4f}")
                    last_heartbeat = now
                    peak_score = 0.0
                    frames_seen = 0

                if top >= self._threshold:
                    logger.info(f"[wake] FIRED — score={top:.3f}")
                    cooldown_until = now + self._cooldown_s
                    try:
                        await self._on_wake()
                    except Exception as e:
                        logger.error(f"[wake] callback failed: {e}")
        finally:
            audio.unsubscribe(sub_id)

    def stop(self) -> None:
        self._stop.set()
