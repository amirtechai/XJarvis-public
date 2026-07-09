"""Image optimization for LLM ingestion."""
from __future__ import annotations

import base64

import cv2
import numpy as np


MAX_LONG_SIDE = 1280
JPEG_QUALITY = 85


def _resize(frame: np.ndarray, max_long_side: int = MAX_LONG_SIDE) -> np.ndarray:
    h, w = frame.shape[:2]
    long_side = max(h, w)
    if long_side <= max_long_side:
        return frame
    scale = max_long_side / long_side
    return cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def optimize_for_llm(frame: np.ndarray) -> str:
    """Return a base64-encoded JPEG suitable for vision LLM input."""
    sized = _resize(frame)
    ok, buf = cv2.imencode(".jpg", sized, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    if not ok:
        raise RuntimeError("jpeg encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def to_jpeg_bytes(frame: np.ndarray, max_long_side: int = MAX_LONG_SIDE, quality: int = JPEG_QUALITY) -> bytes:
    sized = _resize(frame, max_long_side)
    ok, buf = cv2.imencode(".jpg", sized, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("jpeg encode failed")
    return buf.tobytes()


def apply_enhancement(frame: np.ndarray) -> np.ndarray:
    """Light auto-contrast + sharpen for low-light desks."""
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    enhanced = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    kernel = np.array([[0, -0.3, 0], [-0.3, 2.2, -0.3], [0, -0.3, 0]], dtype=np.float32)
    return cv2.filter2D(enhanced, -1, kernel)


REGION_LABELS = (
    ("top-left", "top-center", "top-right"),
    ("middle-left", "center", "middle-right"),
    ("bottom-left", "bottom-center", "bottom-right"),
)


def extract_regions(frame: np.ndarray) -> dict[str, np.ndarray]:
    """Divide frame into a 3x3 grid; return labeled crops for spatial context."""
    h, w = frame.shape[:2]
    rh, rw = h // 3, w // 3
    out: dict[str, np.ndarray] = {}
    for r in range(3):
        for c in range(3):
            label = REGION_LABELS[r][c]
            out[label] = frame[r * rh : (r + 1) * rh, c * rw : (c + 1) * rw].copy()
    return out
