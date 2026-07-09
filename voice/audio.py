"""Single shared microphone stream with subscribers + ring buffer.

One sd.InputStream, fan-out to multiple consumers (wake detector, capture).
All audio is 16 kHz mono int16. Captures pause cleanly during TTS playback.
"""

from __future__ import annotations

import threading
from collections import deque
from typing import Callable

import numpy as np
import sounddevice as sd
from loguru import logger

SAMPLE_RATE = 16_000
BLOCK_MS = 80  # 80ms blocks → 1280 samples (OWW native)
BLOCK_SAMPLES = SAMPLE_RATE * BLOCK_MS // 1000
PREROLL_SEC = 2.0
PREROLL_BLOCKS = int(PREROLL_SEC * 1000 / BLOCK_MS)

PCMCallback = Callable[[bytes], None]


class AudioCapture:
    def __init__(self) -> None:
        self._stream: sd.InputStream | None = None
        self._subs: dict[int, PCMCallback] = {}
        # Barge-in probe'ları: SADECE mute (TTS) sırasında chunk alır → kullanıcı
        # araya girince tespit. Normal sub'lar TTS'te chunk almaz (eko sızmasın).
        self._barge_subs: dict[int, PCMCallback] = {}
        self._next_id = 0
        self._lock = threading.Lock()
        self._preroll: deque[bytes] = deque(maxlen=PREROLL_BLOCKS)
        self._muted = False

    def subscribe(self, cb: PCMCallback) -> int:
        with self._lock:
            sid = self._next_id
            self._next_id += 1
            self._subs[sid] = cb
        return sid

    def unsubscribe(self, sid: int) -> None:
        with self._lock:
            self._subs.pop(sid, None)

    def subscribe_barge(self, cb: PCMCallback) -> int:
        """TTS sırasında (mute) chunk alan barge-in probe'u ekle."""
        with self._lock:
            sid = self._next_id
            self._next_id += 1
            self._barge_subs[sid] = cb
        return sid

    def mute(self) -> None:
        """Gate all audio output to subscribers (TTS in progress).

        Also wipes the preroll buffer so that the next STT capture cannot
        pick up TTS audio that leaked through the speakers.
        """
        with self._lock:
            self._muted = True
            self._preroll.clear()

    def unmute(self) -> None:
        with self._lock:
            self._muted = False
            self._preroll.clear()

    def get_preroll(self) -> bytes:
        with self._lock:
            if self._muted:
                return b""
            return b"".join(self._preroll)

    def _callback(self, indata, frames, time_info, status) -> None:  # noqa: ANN001
        if status:
            logger.debug(f"[audio] {status}")
        try:
            pcm_i16 = (indata[:, 0] * 32767).astype(np.int16).tobytes()
        except Exception:
            return
        with self._lock:
            if self._muted:
                # TTS çalarken: normal sub'lara/preroll'a verme (eko sızmasın),
                # AMA barge-in probe'larına ver → kullanıcı araya girerse tespit.
                barge = list(self._barge_subs.values())
                subs = []
            else:
                self._preroll.append(pcm_i16)
                subs = list(self._subs.values())
                barge = []
        for cb in subs:
            try:
                cb(pcm_i16)
            except Exception as e:
                logger.warning(f"[audio] sub error: {e}")
        for cb in barge:
            try:
                cb(pcm_i16)
            except Exception as e:
                logger.warning(f"[audio] barge sub error: {e}")

    def start(self) -> None:
        if self._stream is not None:
            return
        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            blocksize=BLOCK_SAMPLES,
            channels=1,
            dtype="float32",
            callback=self._callback,
        )
        self._stream.start()
        logger.info(
            f"[audio] mic stream started — {SAMPLE_RATE}Hz, {BLOCK_MS}ms blocks"
        )

    def stop(self) -> None:
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None


_INSTANCE: AudioCapture | None = None


def get_audio() -> AudioCapture:
    global _INSTANCE
    if _INSTANCE is None:
        _INSTANCE = AudioCapture()
    return _INSTANCE
