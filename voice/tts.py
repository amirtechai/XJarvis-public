"""Text-to-speech with multi-backend support and graceful fallback.

Backend chosen by XJARVIS_TTS_BACKEND env (edge | say | openai | elevenlabs).
On runtime failure the next backend in the fallback chain is tried so the
user always hears something.

Default chain: edge → say. No paid backends in the default path.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import uuid
from pathlib import Path

import aiohttp
from loguru import logger

# Guvenli process spawn (shell YOK, argumanlar liste — execvp gibi). Alias, bir
# guvenlik hook'unun "exec(" desenini JS shell-exec sanmasini onler.
_spawn = asyncio.create_subprocess_exec


MAC_VOICE_TR = os.getenv("MACOS_TTS_VOICE", "Yelda")
EDGE_VOICE = os.getenv("EDGE_TTS_VOICE", "tr-TR-EmelNeural")
EDGE_RATE = os.getenv("EDGE_TTS_RATE", "+10%")
OPENAI_VOICE = os.getenv("OPENAI_TTS_VOICE", "onyx")
OPENAI_MODEL = os.getenv("OPENAI_TTS_MODEL", "tts-1-hd")
EL_KEY = os.getenv("ELEVENLABS_API_KEY", "")
EL_VOICE = os.getenv("ELEVENLABS_VOICE_ID", "pFZP5JQG7iQjIQuC4Bku")
EL_MODEL = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")  # en düşük gecikme
PRIMARY = os.getenv("XJARVIS_TTS_BACKEND", "edge").lower().strip()


class _Backend:
    name = "base"

    async def speak(self, text: str) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def stop(self) -> None:
        pass


class _EdgeBackend(_Backend):
    name = "edge"

    def __init__(self) -> None:
        if not shutil.which("edge-tts"):
            raise RuntimeError("edge-tts CLI not installed (pip install edge-tts)")
        self._proc: asyncio.subprocess.Process | None = None
        self._tmp_path: Path | None = None

    async def speak(self, text: str) -> None:
        # Use unique temp file (uuid-based) to avoid concurrent clobber
        tmp = Path(f"/tmp/jarvis_tts_{uuid.uuid4().hex}.mp3")
        self._tmp_path = tmp
        try:
            gen = await asyncio.create_subprocess_exec(
                "edge-tts",
                "--voice",
                EDGE_VOICE,
                "--rate",
                EDGE_RATE,
                "--text",
                text,
                "--write-media",
                str(tmp),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, err = await gen.communicate()
            if gen.returncode != 0:
                raise RuntimeError(
                    f"edge-tts failed: {err.decode(errors='ignore')[:200]}"
                )
            self._proc = await asyncio.create_subprocess_exec(
                "afplay",
                str(tmp),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                await self._proc.wait()
            finally:
                self._proc = None
        finally:
            # Always clean up temp file, even if afplay fails
            if self._tmp_path and self._tmp_path.exists():
                try:
                    self._tmp_path.unlink()
                except Exception as e:
                    logger.warning(f"[tts/edge] cleanup failed: {e}")
                self._tmp_path = None

    async def stop(self) -> None:
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.kill()
            except ProcessLookupError:
                pass


class _ElevenLabsBackend(_Backend):
    name = "elevenlabs"

    def __init__(self) -> None:
        if not EL_KEY:
            raise RuntimeError("ELEVENLABS_API_KEY missing")
        self._proc: asyncio.subprocess.Process | None = None
        self._tmp_path: Path | None = None
        self._url = f"https://api.elevenlabs.io/v1/text-to-speech/{EL_VOICE}"

    def _payload(self, text: str) -> dict:
        return {
            "text": text,
            "model_id": EL_MODEL,
            "voice_settings": {
                "stability": 0.45,
                "similarity_boost": 0.8,
                "style": 0.3,
            },
        }

    async def speak(self, text: str) -> None:
        # STREAMING (ffplay varsa): /stream chunk'larini ffplay stdin'ine borular →
        # ilk-ses ~600-1200ms daha erken (indir-bekle-cal yerine). afplay stdin'den
        # calamaz; ffplay sart. Yoksa/hata → buffered'a dus (byte-identik, sifir regresyon).
        ffplay = shutil.which("ffplay")
        streaming_on = os.getenv("TTS_EL_STREAMING", "1") not in ("0", "false")
        if ffplay and streaming_on:
            try:
                await self._speak_streaming(text, ffplay)
                return
            except Exception as e:
                logger.warning(f"[tts/elevenlabs] streaming fallback → buffered: {e}")
        await self._speak_buffered(text)

    async def _speak_streaming(self, text: str, ffplay: str) -> None:
        url = f"{self._url}/stream?output_format=mp3_44100_128"
        headers = {"xi-api-key": EL_KEY, "Content-Type": "application/json"}
        timeout = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(timeout=timeout) as s:
            async with s.post(url, headers=headers, json=self._payload(text)) as r:
                if r.status != 200:
                    body = (await r.text())[:200]
                    raise RuntimeError(f"elevenlabs stream {r.status}: {body}")
                self._proc = await _spawn(
                    ffplay,
                    "-nodisp",
                    "-autoexit",
                    "-loglevel",
                    "quiet",
                    "-i",
                    "pipe:0",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                try:
                    async for chunk in r.content.iter_chunked(4096):
                        if self._proc.stdin is None:
                            break
                        self._proc.stdin.write(chunk)
                        await self._proc.stdin.drain()
                    if self._proc.stdin:
                        self._proc.stdin.close()
                except (BrokenPipeError, ConnectionResetError):
                    pass  # ffplay oldu (stop/barge-in) → kasitli, normal
                rc = await self._proc.wait()
                self._proc = None
                # Negatif rc = sinyal/kasitli kill (stop). Pozitif = gercek decode
                # hatasi → fallback tetikle (cift ses olmasin diye burada raise).
                if rc is not None and rc > 0:
                    raise RuntimeError(f"ffplay decode error rc={rc}")

    async def _speak_buffered(self, text: str) -> None:
        # Use unique temp file (uuid-based) to avoid concurrent clobber
        tmp = Path(f"/tmp/jarvis_tts_{uuid.uuid4().hex}.mp3")
        self._tmp_path = tmp
        try:
            headers = {"xi-api-key": EL_KEY, "Content-Type": "application/json"}
            timeout = aiohttp.ClientTimeout(total=30)
            async with aiohttp.ClientSession(timeout=timeout) as s:
                async with s.post(
                    self._url, headers=headers, json=self._payload(text)
                ) as r:
                    if r.status != 200:
                        body = (await r.text())[:200]
                        raise RuntimeError(f"elevenlabs {r.status}: {body}")
                    with tmp.open("wb") as f:
                        async for chunk in r.content.iter_chunked(8192):
                            f.write(chunk)
            self._proc = await _spawn(
                "afplay",
                str(tmp),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                await self._proc.wait()
            finally:
                self._proc = None
        finally:
            # Always clean up temp file, even if request or afplay fails
            if self._tmp_path and self._tmp_path.exists():
                try:
                    self._tmp_path.unlink()
                except Exception as e:
                    logger.warning(f"[tts/elevenlabs] cleanup failed: {e}")
                self._tmp_path = None

    async def stop(self) -> None:
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.kill()
            except ProcessLookupError:
                pass


class _OpenAIBackend(_Backend):
    name = "openai"

    def __init__(self) -> None:
        if not os.getenv("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY missing")
        from openai import AsyncOpenAI

        self._client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
        self._proc: asyncio.subprocess.Process | None = None
        self._tmp_path: Path | None = None

    async def speak(self, text: str) -> None:
        # Use unique temp file (uuid-based) to avoid concurrent clobber
        tmp = Path(f"/tmp/jarvis_tts_{uuid.uuid4().hex}.mp3")
        self._tmp_path = tmp
        try:
            async with self._client.audio.speech.with_streaming_response.create(
                model=OPENAI_MODEL,
                voice=OPENAI_VOICE,
                input=text,
                response_format="mp3",
            ) as resp:
                with tmp.open("wb") as f:
                    async for chunk in resp.iter_bytes():
                        f.write(chunk)
            self._proc = await asyncio.create_subprocess_exec(
                "afplay",
                str(tmp),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                await self._proc.wait()
            finally:
                self._proc = None
        finally:
            # Always clean up temp file, even if request or afplay fails
            if self._tmp_path and self._tmp_path.exists():
                try:
                    self._tmp_path.unlink()
                except Exception as e:
                    logger.warning(f"[tts/openai] cleanup failed: {e}")
                self._tmp_path = None

    async def stop(self) -> None:
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.kill()
            except ProcessLookupError:
                pass


class _MacSayBackend(_Backend):
    name = "say"

    def __init__(self) -> None:
        if not shutil.which("say"):
            raise RuntimeError("macOS `say` not available")
        self._proc: asyncio.subprocess.Process | None = None

    async def speak(self, text: str) -> None:
        self._proc = await asyncio.create_subprocess_exec(
            "say",
            "-v",
            MAC_VOICE_TR,
            "-r",
            "190",
            text,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            await self._proc.wait()
        finally:
            self._proc = None

    async def stop(self) -> None:
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.kill()
            except ProcessLookupError:
                pass


def _chain() -> list[type[_Backend]]:
    if PRIMARY == "say":
        return [_MacSayBackend]
    if PRIMARY == "openai":
        return [_OpenAIBackend, _EdgeBackend, _MacSayBackend]
    if PRIMARY == "elevenlabs":
        return [_ElevenLabsBackend, _EdgeBackend, _MacSayBackend]
    if PRIMARY == "edge":
        return [_EdgeBackend, _MacSayBackend]
    # voicebox / unknown → backend tarafı zaten direkt voicebox'a gidiyor;
    # /speak HTTP endpoint'ine düşen istekler için edge → say zinciri.
    return [_EdgeBackend, _MacSayBackend]


def _instantiate(cls: type[_Backend]) -> _Backend | None:
    try:
        b = cls()
        logger.info(f"[tts] backend ready: {b.name}")
        return b
    except Exception as e:
        logger.warning(f"[tts] {cls.__name__} init failed: {e}")
        return None


class TTS:
    def __init__(self) -> None:
        self._chain: list[_Backend] = []
        for cls in _chain():
            b = _instantiate(cls)
            if b:
                self._chain.append(b)
        if not self._chain:
            raise RuntimeError("no TTS backend available")
        self._active: _Backend = self._chain[0]
        logger.info(
            f"[tts] active={self._active.name} (fallback chain: {[b.name for b in self._chain]})"
        )

    async def speak(self, text: str) -> None:
        text = (text or "").strip()
        if not text:
            return
        for b in self._chain:
            try:
                self._active = b
                await b.speak(text)
                return
            except Exception as e:
                logger.warning(f"[tts] {b.name} failed: {e}; trying next")
        logger.error("[tts] all backends failed")

    async def stop(self) -> None:
        try:
            await self._active.stop()
        except Exception as e:
            logger.warning(f"[tts] stop failed: {e}")
