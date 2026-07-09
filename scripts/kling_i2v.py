#!/usr/bin/env python3
"""Kling AI image-to-video — fotoğraftan hareketli video üretir.

Kullanım:
  python3 scripts/kling_i2v.py <image_path> <out_mp4> [--prompt "..."] [--dur 5] [--mode std]

Auth: backend/.env içindeki KLING_ACCESS_KEY + KLING_SECRET_KEY (JWT HS256).
"""

from __future__ import annotations

import argparse
import base64
import os
import sys
import time
from pathlib import Path

import jwt
import requests

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / "backend" / ".env"

# Uluslararası hesap önce, çin fallback.
BASES = [
    "https://api-singapore.klingai.com",
    "https://api.klingai.com",
]


def load_keys() -> tuple[str, str]:
    ak = os.getenv("KLING_ACCESS_KEY", "")
    sk = os.getenv("KLING_SECRET_KEY", "")
    if (not ak or not sk) and ENV.exists():
        for line in ENV.read_text().splitlines():
            if line.startswith("KLING_ACCESS_KEY="):
                ak = line.split("=", 1)[1].strip()
            elif line.startswith("KLING_SECRET_KEY="):
                sk = line.split("=", 1)[1].strip()
    if not ak or not sk:
        sys.exit("KLING_ACCESS_KEY / KLING_SECRET_KEY eksik")
    return ak, sk


def make_token(ak: str, sk: str) -> str:
    now = int(time.time())
    payload = {"iss": ak, "exp": now + 1800, "nbf": now - 5}
    return jwt.encode(
        payload, sk, algorithm="HS256", headers={"alg": "HS256", "typ": "JWT"}
    )


def submit(
    base: str, token: str, img_b64: str, prompt: str, dur: int, mode: str
) -> str:
    url = f"{base}/v1/videos/image2video"
    body = {
        "model_name": os.getenv("KLING_MODEL", "kling-v1-6"),
        "image": img_b64,
        "prompt": prompt,
        "duration": str(dur),
        "mode": mode,
        "cfg_scale": 0.5,
    }
    r = requests.post(
        url,
        json=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    data = r.json()
    if r.status_code != 200 or data.get("code") != 0:
        raise RuntimeError(f"submit {r.status_code}: {data}")
    return data["data"]["task_id"]


def poll(base: str, token_fn, task_id: str, timeout_s: int = 600) -> str:
    url = f"{base}/v1/videos/image2video/{task_id}"
    start = time.time()
    while time.time() - start < timeout_s:
        r = requests.get(
            url, headers={"Authorization": f"Bearer {token_fn()}"}, timeout=30
        )
        data = r.json()
        if data.get("code") != 0:
            raise RuntimeError(f"poll: {data}")
        st = data["data"]["task_status"]
        if st == "succeed":
            vids = data["data"]["task_result"]["videos"]
            return vids[0]["url"]
        if st == "failed":
            raise RuntimeError(f"task failed: {data['data'].get('task_status_msg')}")
        print(f"  … {st} ({int(time.time() - start)}s)", flush=True)
        time.sleep(8)
    raise TimeoutError("kling timeout")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("out")
    ap.add_argument(
        "--prompt",
        default=(
            "The android woman's face subtly comes alive: gentle breathing, "
            "natural eye blinks, slight head movement, lips parting as if speaking softly. "
            "Cinematic, photorealistic, smooth motion, static camera."
        ),
    )
    ap.add_argument("--dur", type=int, default=5)
    ap.add_argument("--mode", default="std")
    args = ap.parse_args()

    ak, sk = load_keys()
    img_b64 = base64.b64encode(Path(args.image).read_bytes()).decode()

    last_err = None
    for base in BASES:
        try:
            token = make_token(ak, sk)
            print(f"[kling] submit → {base}")
            task_id = submit(base, token, img_b64, args.prompt, args.dur, args.mode)
            print(f"[kling] task_id={task_id}, bekleniyor…")
            video_url = poll(base, lambda: make_token(ak, sk), task_id)
            print(f"[kling] video hazır: {video_url}")
            vr = requests.get(video_url, timeout=120)
            Path(args.out).write_bytes(vr.content)
            print(f"[kling] indirildi → {args.out} ({len(vr.content) // 1024} KB)")
            return
        except Exception as e:
            last_err = e
            print(f"[kling] {base} hata: {e}")
    sys.exit(f"Kling başarısız: {last_err}")


if __name__ == "__main__":
    main()
