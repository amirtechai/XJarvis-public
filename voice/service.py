"""XJarvis voice service v2 — clean, minimal, deterministic.

Pipeline:
  IDLE → wake (OpenWakeWord 'hey_jarvis') → LISTENING → capture utterance
  → batch STT (OpenAI gpt-4o-mini-transcribe) → emit STT_FINAL + voice_input
  → backend agent processes → calls back via /speak → SPEAKING (TTS) → IDLE

Mic is muted at audio bus level during TTS playback — no echo guard hacks.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time as _time
from datetime import datetime
from pathlib import Path

from aiohttp import web
from dotenv import load_dotenv
from loguru import logger
import websockets

# Load env
load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")

import numpy as np  # noqa: E402

from voice.audio import BLOCK_MS, get_audio  # noqa: E402
from voice.wake import WakeDetector  # noqa: E402
from voice.wake_keywords import WakeKeywordScanner  # noqa: E402
from voice.stt import capture_and_transcribe, UNCLEAR as STT_UNCLEAR  # noqa: E402
from voice.tts import TTS  # noqa: E402

BUS_URL = os.getenv("JARVIS_BUS_URL", "ws://localhost:3001")
TTS_PORT = int(os.getenv("VOICE_TTS_PORT", "8766"))
TTS_TAIL_S = float(os.getenv("VOICE_TTS_TAIL_S", "0.8"))
GREETING_ENABLED = os.getenv("WAKE_GREETING_ENABLED", "true").lower() == "true"
LANG = os.getenv("XJARVIS_LANG", "en")

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
logger.remove()
logger.add(sys.stderr, level=os.getenv("LOG_LEVEL", "INFO"))
# No file sink — parent process redirects stderr to logs/voice.log; adding
# a second sink would write every line twice.

# Window during which we listen without requiring the wake word again after
# a TTS turn — gives a ChatGPT-style back-and-forth. Set to 0 to disable.
FOLLOWUP_WINDOW_S = float(os.getenv("VOICE_FOLLOWUP_WINDOW_S", "8.0"))

# Whisper tabanlı ikinci wake tarayıcısı (jarvis/alex/jaro...). OpenWakeWord
# ile aynı anda çalışınca ortam sesini sürekli transkript edip rastgele
# dillerde halüsine ediyor + CPU yiyor + ollama ile yarışıyor. Varsayılan
# KAPALI; sadece OpenWakeWord 'hey jarvis' kullan. Açmak için =true.
WAKE_KEYWORDS_ENABLED = os.getenv("WAKE_KEYWORDS_ENABLED", "false").lower() == "true"

# Akustik wake-word (OpenWakeWord). PTT-only modda kapalı: wake yolları senin
# konuşmanda tetiklenip _capturing kilidini 6s'ye kadar tutuyor → PTT 'busy'
# deyip 5-6s gecikiyordu. Wake'i geri açmak için: WAKE_WORD_ENABLED=true
WAKE_WORD_ENABLED = os.getenv("WAKE_WORD_ENABLED", "false").lower() == "true"

# Barge-in: TTS çalarken kullanıcı araya girince sustur+dinle. Eko (hoparlör →
# mic) yanlış tetiklemesin diye YÜKSEK eşik + sürekli ses. Hoparlör kullanıyorsan
# ve kendi sesine kesiyorsa BARGE_RMS'i yükselt; kapatmak için BARGE_IN=0.
BARGE_IN_ENABLED = os.getenv("BARGE_IN", "1") not in ("0", "false")
BARGE_RMS = float(os.getenv("BARGE_RMS", "0.06"))
BARGE_MIN_MS = float(os.getenv("BARGE_MIN_MS", "260"))


def _greeting() -> str:
    h = datetime.now().hour
    if 5 <= h < 12:
        return "Good morning, sir."
    if 12 <= h < 18:
        return "Yes sir."
    if 18 <= h < 23:
        return "Good evening, sir."
    return "Yes sir."


class VoiceService:
    def __init__(self) -> None:
        self.audio = get_audio()
        self.tts = TTS()
        self.wake = WakeDetector(on_wake=self._on_wake)
        self.wake_kw = WakeKeywordScanner(on_wake=self._on_wake)
        self._stop = asyncio.Event()
        self._bus_ws: websockets.WebSocketClientProtocol | None = None
        self._mic_on = True
        self._jarvis_on = True
        self._capturing = False
        self._tts_speaking = False
        self._tts_started_at: float = 0.0
        # Echo guard: son TTS metnini hatırla, STT bunun yakın eşi gelirse drop et
        self._last_tts_text = ""
        self._follow_up_armed_at: float = 0.0
        # Canlı sohbet modu (engine=agent): sürekli dinle→Sonnet→TTS döngüsü
        self._convo_active = False
        self._awaiting_response = False
        # Barge-in (TTS sırasında araya girme) durumu
        self._barge_voiced = 0.0
        self._loop = None
        self._convo_task: asyncio.Task | None = None

    # ──────── Bus emit ────────

    async def emit(
        self, event: str, payload: dict | None = None, source: str = "voice"
    ) -> None:
        if self._bus_ws is None:
            return
        try:
            await self._bus_ws.send(
                json.dumps(
                    {
                        "type": "bus_emit",
                        "event": event,
                        "payload": payload or {},
                        "source": source,
                    }
                )
            )
        except Exception as e:
            logger.warning(f"[bus] emit failed: {e}")

    def _emit_amplitude(self, rms: float) -> None:
        """Mic RMS'i 0..1 amplitude'e çevirip bus'a yay → avatar konuşurken canlı
        tepki versin (VOICE_AMPLITUDE). Sync — capture döngüsünden çağrılır, async
        emit'i create_task ile sıraya koyar."""
        if self._bus_ws is None:
            return
        try:
            amp = min(1.0, max(0.0, float(rms) * 14.0))
            asyncio.create_task(self.emit("VOICE_AMPLITUDE", {"amplitude": amp}))
        except Exception:
            pass

    def _barge_probe(self, pcm_i16: bytes) -> None:
        """TTS sırasında (audio thread'inde) çağrılır. Kullanıcı YÜKSEK + SÜREKLI
        ses çıkarırsa barge-in tetikle. Hoparlör eko'suna takılmamak için eşik
        yüksek (BARGE_RMS) + sürekli ses (BARGE_MIN_MS) şart."""
        if not (BARGE_IN_ENABLED and self._convo_active and self._tts_speaking):
            self._barge_voiced = 0.0
            return
        try:
            arr = np.frombuffer(pcm_i16, dtype=np.int16).astype(np.float32) / 32768.0
            rms = float(np.sqrt(np.mean(arr * arr))) if arr.size else 0.0
        except Exception:
            return
        if rms > BARGE_RMS:
            self._barge_voiced += BLOCK_MS
            if self._barge_voiced >= BARGE_MIN_MS:
                self._barge_voiced = 0.0
                loop = self._loop
                if loop is not None:
                    loop.call_soon_threadsafe(
                        lambda: asyncio.ensure_future(self._do_barge())
                    )
        else:
            self._barge_voiced = max(0.0, self._barge_voiced - BLOCK_MS)

    async def _do_barge(self) -> None:
        """Kullanıcı araya girdi → TTS'i kes, dinlemeye dön."""
        if not (self._convo_active and self._tts_speaking):
            return
        logger.info("[barge] kullanıcı araya girdi → TTS kesiliyor, dinleniyor")
        # tts_bridge LISTENING_START reason=barge_in'i alınca playback'i abort eder
        await self.emit("LISTENING_START", {"channel": "convo", "reason": "barge_in"})
        self._tts_speaking = False
        self._awaiting_response = False
        self.audio.unmute()

    async def send_voice_input(self, text: str) -> None:
        if self._bus_ws is None:
            return
        try:
            await self._bus_ws.send(
                json.dumps({"type": "voice_input", "content": text})
            )
        except Exception as e:
            logger.warning(f"[bus] voice_input send failed: {e}")

    # ──────── Wake → capture ────────

    async def _on_wake(
        self, no_speech_abort_s: float | None = None, channel: str = "wake"
    ) -> str | None:
        if not self._mic_on or not self._jarvis_on:
            logger.info("[wake] ignored — mic/jarvis off")
            return
        if self._capturing:
            logger.info("[wake] ignored — capture in progress")
            return
        if self._tts_speaking:
            logger.info("[wake] ignored — TTS speaking")
            return

        self._capturing = True
        try:
            if channel == "wake":
                await self.emit("WAKE_WORD_DETECTED")
            await self.emit("LISTENING_START", {"channel": channel})

            if GREETING_ENABLED and channel == "wake":
                # Quick chime instead of speech, so it doesn't drown out the user's command
                self._play_chime()

            def on_partial(text: str) -> None:
                # fire-and-forget partial event
                try:
                    asyncio.create_task(self.emit("STT_PARTIAL", {"text": text}))
                except Exception:
                    pass

            # Sohbet modunda uzun anlatıma izin ver — PTT'nin kısa-komut
            # eşikleri (6s / 650ms) cümleyi ortada kesiyordu.
            convo_max = convo_silence = None
            if channel == "convo":
                # Dengeli: uzun anlatıma izin ver ama sessizlikte ortam sesini
                # toplayıp agent'a çöp göndermesin (çok uzun pencere saçmalatıyordu).
                convo_max = float(os.getenv("CONVO_MAX_UTTERANCE_S", "20"))
                # 1200→850→600: cümle bitince çok daha çabuk cevapla (snappy endpointing).
                convo_silence = int(os.getenv("CONVO_SILENCE_END_MS", "600"))

            text = await capture_and_transcribe(
                on_partial=on_partial,
                no_speech_abort_s=no_speech_abort_s,
                max_utterance_s=convo_max,
                silence_end_ms=convo_silence,
                on_amplitude=self._emit_amplitude,  # canlı tepki: avatar sesinle nabız
            )
            unclear = text == STT_UNCLEAR
            await self.emit("LISTENING_END", {"text": "" if unclear else text})

            if unclear:
                # Konuşuldu ama anlaşılmadı → nazik görsel geri bildirim (TTS yok,
                # ortam gürültüsünde sürekli çalmasın diye). "beni anlamıyor" şikayeti.
                logger.info("[wake] anlaşılamadı → STT_UNCLEAR")
                await self.emit("STT_UNCLEAR", {})
                return

            if not text:
                logger.info("[wake] no transcript captured")
                return

            if self._is_tts_echo(text):
                logger.info(f"[echo] dropped suspected TTS echo: {text!r}")
                return

            await self.emit("STT_FINAL", {"text": text})
            await self.send_voice_input(text)
            return text
        finally:
            self._capturing = False
        return None

    def _is_tts_echo(self, captured: str) -> bool:
        """STT çıktısı son TTS metniyle anlamlı şekilde örtüşüyorsa echo say."""
        last = (self._last_tts_text or "").lower().strip()
        if not last:
            return False
        c = captured.lower().strip()
        if not c:
            return False
        # Çok kısa transcripts — agent cevabının içinde geçiyorsa drop
        if len(c) < 25 and c in last:
            return True
        # Uzunsa token örtüşmesi bak
        c_tokens = set(t for t in c.split() if len(t) > 2)
        if not c_tokens:
            return False
        last_tokens = set(t for t in last.split() if len(t) > 2)
        if not last_tokens:
            return False
        overlap = len(c_tokens & last_tokens) / len(c_tokens)
        return overlap >= 0.6

    def _play_chime(self) -> None:
        try:
            import subprocess

            snd = Path(__file__).parent / "sounds" / "ready.wav"
            if snd.exists():
                subprocess.Popen(
                    ["afplay", "-v", "0.5", str(snd)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
        except Exception:
            pass

    # ──────── Bus loop ────────

    async def bus_loop(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with websockets.connect(BUS_URL, max_size=2**24) as ws:
                    self._bus_ws = ws
                    backoff = 1.0
                    logger.info(f"[bus] connected to {BUS_URL}")
                    await self.emit(
                        "SERVICE_HEALTH_CHANGE", {"service": "voice", "status": "up"}
                    )

                    # Subscribe to TTS playback events for mic gating, and to
                    # RESPONSE_END as a backstop — if TTS silently fails (no
                    # PLAYBACK_END), we still re-open the mic so the user
                    # doesn't have to repeat the wake word for every turn.
                    await ws.send(
                        json.dumps(
                            {
                                "type": "subscribe",
                                "events": [
                                    "TTS_PLAYBACK_START",
                                    "TTS_PLAYBACK_END",
                                    "RESPONSE_END",
                                ],
                            }
                        )
                    )

                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        # Backend forwards events as either {type:"event",event:"..."} or
                        # via direct bus broadcast — accept any envelope with an `event` field
                        ev = msg.get("event") or (msg.get("payload") or {}).get("event")
                        if not ev:
                            continue
                        if ev == "TTS_PLAYBACK_START":
                            self._tts_speaking = True
                            self._tts_started_at = _time.time()
                            self.audio.mute()
                            payload = msg.get("payload") or {}
                            spoken = (payload.get("text") or "").strip()
                            if spoken:
                                self._last_tts_text = spoken
                            logger.info("[bus] TTS started — mic muted")
                        elif ev == "TTS_PLAYBACK_END":
                            self._tts_speaking = False
                            self._follow_up_arm()
                            # Sohbet modu: cevap seslendirildi → dinlemeye dön.
                            if self._convo_active:
                                self._awaiting_response = False
                            # 800ms tail to let speakers settle before unmuting
                            asyncio.create_task(self._unmute_after(TTS_TAIL_S))
                            if FOLLOWUP_WINDOW_S > 0:
                                asyncio.create_task(self._follow_up())
                        elif ev == "RESPONSE_END":
                            # Sohbet modu backstop: TTS sessizce başarısız olsa
                            # bile döngü kilitlenmesin (TTS varsa PLAYBACK_END
                            # zaten temizledi; 3s sonra hâlâ konuşmuyorsa aç).
                            if self._convo_active:
                                asyncio.create_task(self._convo_unlock_after(3.0))
                            if FOLLOWUP_WINDOW_S > 0:
                                asyncio.create_task(self._follow_up_response_end())
            except Exception as e:
                self._bus_ws = None
                if self._stop.is_set():
                    return
                logger.warning(f"[bus] disconnected: {e}; retry in {backoff}s")
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=backoff)
                    return
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 1.6, 30.0)

    async def _unmute_after(self, seconds: float) -> None:
        await asyncio.sleep(seconds)
        if not self._tts_speaking:
            self.audio.unmute()
            logger.info(f"[bus] mic unmuted after {seconds}s tail")

    async def _convo_unlock_after(self, seconds: float) -> None:
        """RESPONSE_END backstop'u: TTS hiç başlamadıysa dinlemeyi geri aç."""
        await asyncio.sleep(seconds)
        if self._convo_active and not self._tts_speaking:
            self._awaiting_response = False

    def _follow_up_arm(self) -> None:
        """Mark that TTS_PLAYBACK_END has fired so the RESPONSE_END backstop
        knows not to double-trigger the follow-up window."""
        self._follow_up_armed_at = _time.time()

    async def _follow_up(self) -> None:
        """Re-open capture after a TTS turn without requiring the wake word.

        Waits for the speaker tail to settle, then runs a single capture pass.
        If the user stays silent within FOLLOWUP_WINDOW_S, capture aborts on
        its own (STT no-speech) and we fall back to wake-word mode.
        """
        # Wait until mic is actually unmuted (after TTS_TAIL_S).
        await asyncio.sleep(TTS_TAIL_S + 0.05)
        if (
            self._tts_speaking
            or self._capturing
            or not self._mic_on
            or not self._jarvis_on
        ):
            return
        logger.info(f"[follow-up] listening {FOLLOWUP_WINDOW_S}s without wake")
        await self._on_wake(no_speech_abort_s=FOLLOWUP_WINDOW_S, channel="followup")

    async def _follow_up_response_end(self) -> None:
        """Backstop follow-up triggered by RESPONSE_END.

        Fires only if TTS_PLAYBACK_END did NOT arm follow-up within the last
        few seconds — i.e. when TTS silently failed and the user would
        otherwise be left without a way to keep the conversation going.
        """
        # Give TTS_PLAYBACK_END a fair chance to fire first.
        await asyncio.sleep(2.0)
        recent = getattr(self, "_follow_up_armed_at", 0)
        if _time.time() - recent < 5.0:
            return  # TTS path already armed follow-up
        if (
            self._tts_speaking
            or self._capturing
            or not self._mic_on
            or not self._jarvis_on
        ):
            return
        logger.info(
            f"[follow-up:backstop] TTS silently failed — listening "
            f"{FOLLOWUP_WINDOW_S}s without wake"
        )
        await self._on_wake(no_speech_abort_s=FOLLOWUP_WINDOW_S, channel="followup")

    # ──────── HTTP handlers ────────

    async def speak_handler(self, request: web.Request) -> web.Response:
        body = await request.json()
        text = (body.get("text") or "").strip()
        if not text:
            return web.json_response({"ok": False, "error": "empty text"}, status=400)

        await self.emit("RESPONSE_START", {"channel": "tts"})
        await self.emit("TTS_PLAYBACK_START", {"text": text[:80]})
        self._tts_speaking = True
        self._tts_started_at = _time.time()
        self._last_tts_text = text
        self.audio.mute()
        try:
            await self.tts.speak(text)
        except Exception as e:
            logger.error(f"[tts] speak failed: {e}")
        finally:
            self._tts_speaking = False
            await self.emit("TTS_PLAYBACK_END", {})
            await self.emit("RESPONSE_END", {"channel": "tts"})
            asyncio.create_task(self._unmute_after(TTS_TAIL_S))
        return web.json_response({"ok": True})

    async def stop_handler(self, _: web.Request) -> web.Response:
        try:
            await self.tts.stop()
        except Exception:
            pass
        return web.json_response({"ok": True})

    async def wake_handler(self, _: web.Request) -> web.Response:
        asyncio.create_task(self._on_wake())
        return web.json_response({"ok": True})

    # ──────── Push-to-talk (bas-konuş) ────────
    # F5 basılı tutulunca /ptt/start, bırakılınca /ptt/stop çağrılır. Gürültüde
    # VAD'siz, gecikmesiz, %100 güvenilir — wake-word'e gerek yok.

    async def _set_output_muted(self, muted: bool) -> None:
        # PTT sırasında sistem çıkış sesini kıs (ducking). Kullanıcı "ben demeden
        # sesi azaltıyor" dediği için VARSAYILAN KAPALI. Açmak için PTT_DUCK_AUDIO=1.
        if os.getenv("PTT_DUCK_AUDIO", "0") not in ("1", "true"):
            return
        try:
            val = "true" if muted else "false"
            p = await asyncio.create_subprocess_exec(
                "osascript",
                "-e",
                f"set volume output muted {val}",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await p.wait()
        except Exception:
            pass

    async def ptt_start_handler(self, _: web.Request) -> web.Response:
        if self._capturing:
            return web.json_response({"ok": False, "error": "busy"})
        from voice.realtime import get_realtime

        if get_realtime().active or self._convo_active:
            return web.json_response({"ok": False, "error": "canlı konuşma modu açık"})
        await self._set_output_muted(True)  # arka plan sesini kıs
        # Önceki TTS'ten _muted takılı kalmış olabilir → audio._callback fan-out'u
        # atlar → kayıt 0 byte gelir. PTT = kullanıcı ŞİMDİ konuşmak istiyor,
        # zorla unmute et. Mic stream durmuşsa yeniden başlat.
        self._tts_speaking = False
        try:
            self.tts and asyncio.create_task(self.tts.stop())
        except Exception:
            pass
        self.audio.unmute()
        cold_start = getattr(self.audio, "_stream", None) is None
        if cold_start:
            self.audio.start()
            # CoreAudio (AUHAL) ~250-400ms ısınır; soğuk başlangıçta ilk bloklar
            # sessiz/0 gelir. Uzun idle sonrası lazy-mic mic'i kapatmış oluyor →
            # Option+A'da aygıt soğuk açılıp kullanıcının ilk kelimeleri kayboluyor,
            # STT sessizliği halüsine ediyor ("Altyazı M.K.") → garbage atılıp CEVAP
            # GELMİYOR. Aygıt gerçek ses üretene dek bekle, chime'ı SONRA çal ki
            # kullanıcı sıcak mic'e konuşsun.
            await asyncio.sleep(float(os.getenv("PTT_WARMUP_S", "0.35")))
        self._capturing = True
        self._ptt_buf = []

        def _collect(pcm: bytes) -> None:
            self._ptt_buf.append(pcm)

        self._ptt_sub = self.audio.subscribe(_collect)
        await self.emit("LISTENING_START", {"channel": "ptt"})
        self._play_chime()
        logger.info(
            "[ptt] recording started" + (" (cold warm-up)" if cold_start else "")
        )
        return web.json_response({"ok": True})

    async def ptt_stop_handler(self, _: web.Request) -> web.Response:
        await self._set_output_muted(False)  # sistem sesini geri aç
        sub = getattr(self, "_ptt_sub", None)
        if sub is None:
            self._capturing = False
            return web.json_response({"ok": False, "error": "not recording"})
        self.audio.unsubscribe(sub)
        self._ptt_sub = None
        pcm = b"".join(getattr(self, "_ptt_buf", []))
        self._ptt_buf = []
        await self.emit("LISTENING_END", {})
        logger.info(f"[ptt] recording stopped — {len(pcm)} bytes, transcribing")
        try:
            from voice.stt import transcribe, _is_garbage

            text = await transcribe(pcm)
            if text and _is_garbage(text):
                logger.info(f"[ptt] dropped garbage: {text!r}")
                text = ""
        except Exception as e:
            logger.error(f"[ptt] transcribe failed: {e}")
            text = ""
        finally:
            self._capturing = False
        if text and not self._is_tts_echo(text):
            logger.info(f"[ptt] → {text!r}")
            await self.emit("STT_FINAL", {"text": text})
            await self.send_voice_input(text)
        elif not text and len(pcm) > 8000:
            # Anlamlı ses (~0.25s+) kaydedildi ama metin çıkmadı (garbage/düşük-güven)
            # → nazik geri bildirim ("net duyamadım"), sessizce yutmak yerine.
            logger.info("[ptt] ses vardı ama anlaşılamadı → STT_UNCLEAR")
            await self.emit("STT_UNCLEAR", {})
        # Lazy-mic: PTT bitti → mic aygıtını KAPAT. Tray'de beklerken mic
        # gerçekten kapalı (gizlilik). Sonraki Option+A /ptt/start'ta yeniden açılır.
        if os.getenv("PTT_LAZY_MIC", "1") not in ("0", "false"):
            try:
                self.audio.stop()
                logger.info("[ptt] mic stream kapatıldı (lazy-mic)")
            except Exception:
                pass
        return web.json_response({"ok": True, "text": text})

    async def status_handler(self, _: web.Request) -> web.Response:
        from voice.realtime import get_realtime

        return web.json_response(
            {
                "wake_configured": True,
                "bus_connected": self._bus_ws is not None,
                "mic_on": self._mic_on,
                "jarvis_on": self._jarvis_on,
                "capturing": self._capturing,
                "tts_speaking": self._tts_speaking,
                "realtime": get_realtime().status,
                "language": LANG,
            }
        )

    # ── Canlı sohbet modu ─────────────────────────────────────────────
    # engine=agent (VARSAYILAN): sürekli dinle → Groq STT → XJarvis agent
    #   (Sonnet 4.6 + tüm tool/skill'ler) → TTS → tekrar dinle. Beyin = Sonnet.
    # engine=gemini: Gemini Live speech-to-speech (tool'suz, en düşük gecikme).
    async def _convo_loop(self) -> None:
        no_speech_s = float(os.getenv("CONVO_NO_SPEECH_S", "6"))
        logger.info("[convo] sohbet modu başladı (engine=agent, beyin=Sonnet)")
        while self._convo_active:
            if self._tts_speaking or self._capturing or self._awaiting_response:
                await asyncio.sleep(0.25)
                continue
            # TTS sonrası mic hâlâ mute olabilir (unmute kuyrukta) → _on_wake'i
            # boşa açıp 6s no-speech harcamasın; unmute olana dek kısa bekle.
            if getattr(self.audio, "_muted", False):
                await asyncio.sleep(0.12)
                continue
            try:
                text = await self._on_wake(
                    no_speech_abort_s=no_speech_s, channel="convo"
                )
            except Exception as e:
                logger.warning(f"[convo] capture hatası: {e}")
                await asyncio.sleep(1.0)
                continue
            if text:
                # Cevap (RESPONSE_END / TTS sonu) gelene dek yeni kayıt açma.
                self._awaiting_response = True
                asyncio.create_task(self._convo_response_timeout())
        logger.info("[convo] sohbet modu bitti")

    async def _convo_response_timeout(self) -> None:
        """Agent cevabı hiç gelmezse sohbeti kilitleme — timeout sonra dinlemeye dön.
        120→25: RESPONSE_END/TTS_END düşerse 2 dk donmasın, hızlı toparlasın."""
        await asyncio.sleep(float(os.getenv("CONVO_RESPONSE_TIMEOUT_S", "25")))
        if self._awaiting_response:
            logger.warning("[convo] cevap zaman aşımı — dinlemeye dönülüyor")
            self._awaiting_response = False

    async def realtime_start_handler(self, request: web.Request) -> web.Response:
        if self._capturing:
            return web.json_response({"ok": False, "error": "PTT kaydı sürüyor"})
        try:
            body = await request.json()
        except Exception:
            body = {}
        engine = (body.get("engine") or os.getenv("REALTIME_ENGINE", "agent")).lower()

        if engine == "gemini":
            from voice.realtime import get_realtime

            result = await get_realtime().start()
            if result.get("ok"):
                await self.emit("REALTIME_START", {"engine": "gemini"})
            return web.json_response({**result, "engine": "gemini"})

        # engine=agent — Sonnet + tool'lu sohbet döngüsü
        if self._convo_active:
            return web.json_response({"ok": True, "already": True, "engine": "agent"})
        self._convo_active = True
        self._awaiting_response = False
        self.audio.start()  # lazy-mic kapalıysa idempotent
        self.audio.unmute()
        self._convo_task = asyncio.create_task(self._convo_loop())
        await self.emit("REALTIME_START", {"engine": "agent"})
        return web.json_response({"ok": True, "engine": "agent", "status": "listening"})

    async def realtime_stop_handler(self, _: web.Request) -> web.Response:
        stopped = []
        if self._convo_active:
            self._convo_active = False
            self._awaiting_response = False
            task = getattr(self, "_convo_task", None)
            if task is not None:
                task.cancel()
                self._convo_task = None
            if os.getenv("PTT_LAZY_MIC", "1") not in ("0", "false"):
                try:
                    self.audio.stop()
                except Exception:
                    pass
            stopped.append("agent")
        from voice.realtime import get_realtime

        rt = get_realtime()
        if rt.active:
            await rt.stop()
            stopped.append("gemini")
        await self.emit("REALTIME_END", {})
        return web.json_response({"ok": True, "stopped": stopped})

    async def realtime_status_handler(self, _: web.Request) -> web.Response:
        from voice.realtime import get_realtime

        rt = get_realtime()
        if self._convo_active:
            if self._tts_speaking:
                status = "speaking"
            elif self._awaiting_response:
                status = "thinking"
            else:
                status = "listening"
            return web.json_response(
                {"active": True, "engine": "agent", "status": status}
            )
        if rt.active:
            return web.json_response(
                {"active": True, "engine": "gemini", "status": rt.status}
            )
        return web.json_response({"active": False, "engine": None, "status": "idle"})

    async def mic_handler(self, request: web.Request) -> web.Response:
        body = await request.json() if request.method == "POST" else {}
        if "on" in body:
            self._mic_on = bool(body["on"])
        else:
            self._mic_on = not self._mic_on
        if not self._mic_on:
            self.wake.disable()
            self.wake_kw.disable()
        else:
            self.wake.enable()
            self.wake_kw.enable()
        await self.emit(
            "SERVICE_HEALTH_CHANGE",
            {"service": "mic", "status": "on" if self._mic_on else "off"},
        )
        return web.json_response({"on": self._mic_on})

    async def jarvis_handler(self, request: web.Request) -> web.Response:
        body = await request.json() if request.method == "POST" else {}
        if "on" in body:
            self._jarvis_on = bool(body["on"])
        else:
            self._jarvis_on = not self._jarvis_on
        await self.emit(
            "SERVICE_HEALTH_CHANGE",
            {"service": "jarvis", "status": "on" if self._jarvis_on else "off"},
        )
        return web.json_response({"on": self._jarvis_on})

    # ──────── Main ────────

    async def run(self) -> None:
        # Barge-in probe'u bağla (TTS sırasında araya girme tespiti) + loop ref
        self._loop = asyncio.get_running_loop()
        self.audio.subscribe_barge(self._barge_probe)
        # Lazy-mic: PTT-only modda mic'i boot'ta AÇMA — sadece Option+A /ptt/start'ta
        # açılır, /ptt/stop'ta kapanır. Wake açıksa veya lazy kapalıysa boot'ta aç.
        _lazy = os.getenv("PTT_LAZY_MIC", "1") not in ("0", "false")
        if not _lazy or WAKE_WORD_ENABLED or WAKE_KEYWORDS_ENABLED:
            self.audio.start()
        else:
            logger.info("[audio] lazy-mic: mic boot'ta kapalı, sadece PTT'de açılır")

        app = web.Application()
        app.router.add_post("/speak", self.speak_handler)
        app.router.add_post("/stop", self.stop_handler)
        app.router.add_post("/wake", self.wake_handler)
        app.router.add_post("/ptt/start", self.ptt_start_handler)
        app.router.add_post("/ptt/stop", self.ptt_stop_handler)
        app.router.add_post("/realtime/start", self.realtime_start_handler)
        app.router.add_post("/realtime/stop", self.realtime_stop_handler)
        app.router.add_get("/realtime/status", self.realtime_status_handler)
        app.router.add_get("/status", self.status_handler)
        app.router.add_post("/mic/toggle", self.mic_handler)
        app.router.add_post("/mic/set", self.mic_handler)
        app.router.add_post("/jarvis/toggle", self.jarvis_handler)
        app.router.add_post("/jarvis/set", self.jarvis_handler)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", TTS_PORT)
        await site.start()
        logger.info(f"[http] listening on http://localhost:{TTS_PORT}")

        bus_task = asyncio.create_task(self.bus_loop())
        if WAKE_WORD_ENABLED:
            wake_task = asyncio.create_task(self.wake.run())
        else:
            logger.info("[wake] disabled (WAKE_WORD_ENABLED=false) — PTT-only mode")
            wake_task = asyncio.create_task(asyncio.sleep(0))
        if WAKE_KEYWORDS_ENABLED:
            wake_kw_task = asyncio.create_task(self.wake_kw.run())
        else:
            logger.info(
                "[wake-kw] disabled (WAKE_KEYWORDS_ENABLED=false) — OpenWakeWord only"
            )
            wake_kw_task = asyncio.create_task(asyncio.sleep(0))
        watchdog_task = asyncio.create_task(self._tts_watchdog())

        await self._stop.wait()
        self.wake.stop()
        self.wake_kw.stop()
        bus_task.cancel()
        wake_task.cancel()
        wake_kw_task.cancel()
        watchdog_task.cancel()
        self.audio.stop()
        await runner.cleanup()

    async def _tts_watchdog(self) -> None:
        """Force-reset _tts_speaking if it stays true for too long (e.g.
        bus disconnect dropped the TTS_PLAYBACK_END event)."""
        MAX_TTS_S = float(os.getenv("VOICE_TTS_WATCHDOG_S", "30.0"))
        while not self._stop.is_set():
            try:
                await asyncio.sleep(5.0)
            except asyncio.CancelledError:
                return
            if self._tts_speaking and self._tts_started_at > 0:
                age = _time.time() - self._tts_started_at
                if age > MAX_TTS_S:
                    logger.warning(
                        f"[watchdog] TTS stuck for {age:.1f}s — forcing reset"
                    )
                    self._tts_speaking = False
                    self._tts_started_at = 0.0
                    try:
                        self.audio.unmute()
                    except Exception:
                        pass


async def main() -> None:
    service = VoiceService()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, service._stop.set)
    await service.run()


if __name__ == "__main__":
    asyncio.run(main())
