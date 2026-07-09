"""Camera lifecycle management with thread-safe latest-frame buffer."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import cv2
import numpy as np
from loguru import logger


class CameraUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True)
class CameraInfo:
    index: int
    width: int
    height: int
    fps: float


class CameraManager:
    """Continuously reads frames in a background thread; on-demand callers get the latest frame."""

    def __init__(self, index: int = 0, prefer_resolutions: tuple[tuple[int, int], ...] = ((1920, 1080), (1280, 720), (640, 480))) -> None:
        # MacBook FaceTime HD: Apple Silicon = 1080p; Intel models = 720p. Start there.
        self._index = index
        self._prefer = prefer_resolutions
        self._cap: cv2.VideoCapture | None = None
        self._lock = threading.Lock()
        self._latest: np.ndarray | None = None
        self._latest_ts: float = 0.0
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._info: CameraInfo | None = None

    @property
    def info(self) -> CameraInfo | None:
        return self._info

    def _open(self) -> cv2.VideoCapture:
        cap = cv2.VideoCapture(self._index)
        if not cap.isOpened():
            raise CameraUnavailableError(f"camera {self._index} did not open")
        for w, h in self._prefer:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
            actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            if actual_w >= w * 0.9:
                break
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        self._info = CameraInfo(self._index, actual_w, actual_h, fps)
        logger.info(f"[capture] opened camera {self._index} @ {actual_w}x{actual_h} {fps:.0f}fps")
        return cap

    def _ensure_open_with_retry(self, total_timeout_s: float = 60.0) -> cv2.VideoCapture:
        start = time.time()
        delay = 1.0
        while time.time() - start < total_timeout_s:
            try:
                return self._open()
            except CameraUnavailableError as e:
                logger.warning(f"[capture] {e}; retrying in {delay:.0f}s")
                time.sleep(delay)
                delay = min(delay * 1.5, 5.0)
        raise CameraUnavailableError(f"camera {self._index} unavailable after {total_timeout_s}s")

    def _loop(self) -> None:
        cap = self._cap
        assert cap is not None
        while not self._stop.is_set():
            ok, frame = cap.read()
            if not ok or frame is None:
                logger.warning("[capture] read failed; reconnecting")
                cap.release()
                try:
                    cap = self._ensure_open_with_retry()
                    self._cap = cap
                except CameraUnavailableError as e:
                    logger.error(f"[capture] permanently lost: {e}")
                    return
                continue
            with self._lock:
                self._latest = frame
                self._latest_ts = time.time()

    def start(self) -> None:
        if self._thread is not None:
            return
        self._cap = self._ensure_open_with_retry()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="vision-capture")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        if self._cap:
            self._cap.release()

    def latest(self) -> tuple[np.ndarray, float]:
        with self._lock:
            if self._latest is None:
                raise CameraUnavailableError("no frame captured yet")
            return self._latest.copy(), self._latest_ts
