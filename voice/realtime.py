"""Gemini Live API ile gerçek-zamanlı sesli konuşma (speech-to-speech).

Mimari: mic (AudioCapture, 16 kHz PCM16) → Live API websocket →
24 kHz PCM16 çıkış (sounddevice OutputStream). STT→LLM→TTS zinciri yok;
tek websocket üzerinden ~saniye-altı sesli diyalog.

Varsayılan YARI çift yönlü (half-duplex): asistan konuşurken mic gönderimi
durur ki hoparlör yankısı modele gitmesin. Kulaklıkla barge-in istenirse
REALTIME_HALF_DUPLEX=0.

Env:
  GEMINI_API_KEY          — zorunlu (backend/.env'den geliyor)
  GEMINI_LIVE_MODEL       — vars: models/gemini-2.5-flash-native-audio-latest
  REALTIME_VOICE          — vars: Puck (Gemini prebuilt ses adı)
  REALTIME_HALF_DUPLEX    — vars: 1
  REALTIME_SYSTEM_PROMPT  — kişilik override
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import threading

import aiohttp
import numpy as np
import sounddevice as sd
from loguru import logger

from .audio import get_audio

LIVE_URL = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
)
OUT_RATE = 24_000  # Live API ses çıkışı 24 kHz PCM16
IN_MIME = "audio/pcm;rate=16000"

DEFAULT_PROMPT = (
    "Sen XJarvis'sin — Türkçe konuşan kişisel sesli asistan. Kullanıcına "
    "'Patron' diye hitap et. Kısa, net ve doğal konuş; gereksiz uzatma. "
    "Bilmediğin şeyi uydurma."
)


class _PcmPlayer:
    """24 kHz PCM16 akışını kesintisiz çalan çıkış stream'i.

    Buffer'a yazılır; callback buffer'dan tüketir, boşsa sessizlik basar.
    interrupt() barge-in'de kuyruktaki sesi anında atar.
    """

    def __init__(self) -> None:
        self._buf = bytearray()
        self._lock = threading.Lock()
        self._stream: sd.OutputStream | None = None

    @property
    def playing(self) -> bool:
        with self._lock:
            return len(self._buf) > 0

    def feed(self, pcm: bytes) -> None:
        with self._lock:
            self._buf.extend(pcm)

    def interrupt(self) -> None:
        with self._lock:
            self._buf.clear()

    def _callback(self, outdata, frames, time_info, status) -> None:  # noqa: ANN001
        need = frames * 2  # int16 mono
        with self._lock:
            chunk = bytes(self._buf[:need])
            del self._buf[: len(chunk)]
        if len(chunk) < need:
            chunk += b"\x00" * (need - len(chunk))
        outdata[:] = np.frombuffer(chunk, dtype=np.int16).reshape(-1, 1)

    def start(self) -> None:
        if self._stream is not None:
            return
        self._stream = sd.OutputStream(
            samplerate=OUT_RATE,
            blocksize=OUT_RATE // 10,  # 100ms
            channels=1,
            dtype="int16",
            callback=self._callback,
        )
        self._stream.start()

    def stop(self) -> None:
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        self.interrupt()


class RealtimeSession:
    """Tek aktif Live oturumu. start() → websocket + mic köprüsü, stop() → temizlik."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._sub_id: int | None = None
        self._send_q: asyncio.Queue[bytes] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._player = _PcmPlayer()
        self._half_duplex = os.getenv("REALTIME_HALF_DUPLEX", "1") not in ("0", "false")
        self.active = False
        self.status = "idle"  # idle | connecting | listening | error:<msg>

    # ── mic köprüsü (sounddevice thread'inden çağrılır) ──────────────
    def _on_pcm(self, pcm: bytes) -> None:
        if not self.active or self._loop is None or self._send_q is None:
            return
        if self._half_duplex and self._player.playing:
            return  # asistan konuşuyor — yankıyı modele gönderme
        try:
            self._loop.call_soon_threadsafe(self._q_put, pcm)
        except RuntimeError:
            pass

    def _q_put(self, pcm: bytes) -> None:
        try:
            self._send_q.put_nowait(pcm)
        except asyncio.QueueFull:
            pass  # backpressure: eski ses bloklarını düşürmek sorun değil

    # ── yaşam döngüsü ────────────────────────────────────────────────
    async def start(self) -> dict:
        if self.active:
            return {"ok": True, "already": True, "status": self.status}
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        if not api_key:
            self.status = "error:GEMINI_API_KEY yok"
            return {"ok": False, "error": "GEMINI_API_KEY tanımlı değil"}

        self._loop = asyncio.get_running_loop()
        self._send_q = asyncio.Queue(maxsize=200)
        self.active = True
        self.status = "connecting"

        audio = get_audio()
        audio.start()  # lazy-mic kapalıysa zaten açık; idempotent
        audio.unmute()
        self._player.start()
        self._sub_id = audio.subscribe(self._on_pcm)
        self._task = asyncio.create_task(self._session_loop(api_key))
        logger.info("[realtime] oturum başlatıldı")
        return {"ok": True, "status": self.status}

    async def stop(self) -> dict:
        if not self.active:
            return {"ok": True, "already": True}
        self.active = False
        if self._sub_id is not None:
            get_audio().unsubscribe(self._sub_id)
            self._sub_id = None
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        self._player.stop()
        # Lazy-mic modunda mic'i kapat (PTT davranışıyla tutarlı gizlilik).
        if os.getenv("PTT_LAZY_MIC", "1") not in ("0", "false"):
            get_audio().stop()
        self.status = "idle"
        logger.info("[realtime] oturum kapatıldı")
        return {"ok": True}

    # ── websocket oturumu ────────────────────────────────────────────
    async def _session_loop(self, api_key: str) -> None:
        model = os.getenv(
            "GEMINI_LIVE_MODEL", "models/gemini-2.5-flash-native-audio-latest"
        )
        voice = os.getenv("REALTIME_VOICE", "Puck")
        prompt = os.getenv("REALTIME_SYSTEM_PROMPT", DEFAULT_PROMPT)
        setup = {
            "setup": {
                "model": model,
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {
                        "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}},
                        "languageCode": "tr-TR",
                    },
                },
                "systemInstruction": {"parts": [{"text": prompt}]},
                "inputAudioTranscription": {},
                "outputAudioTranscription": {},
            }
        }
        try:
            async with aiohttp.ClientSession() as http:
                async with http.ws_connect(
                    f"{LIVE_URL}?key={api_key}", max_msg_size=16 * 1024 * 1024
                ) as ws:
                    await ws.send_json(setup)
                    first = await ws.receive(timeout=15)
                    if (
                        first.type != aiohttp.WSMsgType.TEXT
                        and first.type != aiohttp.WSMsgType.BINARY
                    ):
                        raise RuntimeError(f"setup yanıtı beklenmedik: {first.type}")
                    logger.info(f"[realtime] bağlı — model={model} voice={voice}")
                    self.status = "listening"
                    sender = asyncio.create_task(self._sender(ws))
                    try:
                        await self._receiver(ws)
                    finally:
                        sender.cancel()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"[realtime] oturum hatası: {e}")
            self.status = f"error:{str(e)[:120]}"
            self.active = False
            if self._sub_id is not None:
                get_audio().unsubscribe(self._sub_id)
                self._sub_id = None
            self._player.stop()

    async def _sender(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        while self.active:
            pcm = await self._send_q.get()
            msg = {
                "realtimeInput": {
                    "audio": {
                        "mimeType": IN_MIME,
                        "data": base64.b64encode(pcm).decode(),
                    }
                }
            }
            await ws.send_json(msg)

    async def _receiver(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)
            elif msg.type == aiohttp.WSMsgType.BINARY:
                data = json.loads(msg.data.decode("utf-8", "ignore"))
            elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                logger.warning(f"[realtime] ws kapandı: {msg.type}")
                break
            else:
                continue

            sc = data.get("serverContent") or {}
            if sc.get("interrupted"):
                # Barge-in: kullanıcı söze girdi — kuyruktaki sesi at.
                self._player.interrupt()
            for part in (sc.get("modelTurn") or {}).get("parts", []):
                inline = part.get("inlineData") or {}
                if (inline.get("mimeType") or "").startswith("audio/pcm"):
                    self._player.feed(base64.b64decode(inline.get("data", "")))
            it = (sc.get("inputTranscription") or {}).get("text")
            ot = (sc.get("outputTranscription") or {}).get("text")
            if it:
                logger.info(f"[realtime] sen: {it!r}")
            if ot:
                logger.debug(f"[realtime] jarvis: {ot!r}")
            if data.get("goAway"):
                logger.warning("[realtime] sunucu goAway gönderdi, oturum bitiyor")
                break


_SESSION: RealtimeSession | None = None


def get_realtime() -> RealtimeSession:
    global _SESSION
    if _SESSION is None:
        _SESSION = RealtimeSession()
    return _SESSION
