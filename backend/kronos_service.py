"""
Kronos forecast mikroservisi (CPU). Olasılıksal sinyal — KESİN TAHMİN DEĞİL.
  GET /health
  POST /forecast {market:'crypto'|'forex', symbol, interval, lookback, pred_len, samples}
"""
import sys, os, math
sys.path.append(os.path.dirname(__file__))
from datetime import timedelta
import numpy as np
import pandas as pd
import requests
import torch
from fastapi import FastAPI
from pydantic import BaseModel
from model import Kronos, KronosTokenizer, KronosPredictor

app = FastAPI()
torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))

print("Kronos yükleniyor...", flush=True)
_tok = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
_model = Kronos.from_pretrained("NeoQuasar/Kronos-base")
_predictor = KronosPredictor(_model, _tok, device="cpu", max_context=512)
print("Kronos-base hazır.", flush=True)

UA = {"User-Agent": "Mozilla/5.0 XJarvis"}

def binance_klines(symbol, interval="1d", limit=400):
    r = requests.get("https://api.binance.com/api/v3/klines",
                     params={"symbol": symbol.upper(), "interval": interval, "limit": limit}, timeout=15)
    r.raise_for_status()
    rows = r.json()
    df = pd.DataFrame([{
        "timestamps": pd.to_datetime(k[0], unit="ms"),
        "open": float(k[1]), "high": float(k[2]), "low": float(k[3]),
        "close": float(k[4]), "volume": float(k[5]), "amount": float(k[7]),
    } for k in rows])
    return df

def yahoo_ohlcv(symbol, interval="1d", rng="2y"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    r = requests.get(url, params={"interval": interval, "range": rng}, headers=UA, timeout=15)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    ts = res["timestamp"]; q = res["indicators"]["quote"][0]
    df = pd.DataFrame({
        "timestamps": pd.to_datetime(ts, unit="s"),
        "open": q["open"], "high": q["high"], "low": q["low"], "close": q["close"],
        "volume": [v or 0 for v in q["volume"]],
    }).dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    df["amount"] = (df["volume"] * df["close"]).fillna(0)
    return df

def future_index(last_ts, pred_len, interval):
    step = {"1d": timedelta(days=1), "1h": timedelta(hours=1), "1wk": timedelta(weeks=1)}.get(interval, timedelta(days=1))
    return pd.Series([last_ts + step * (i + 1) for i in range(pred_len)])

class Req(BaseModel):
    market: str = "crypto"
    symbol: str = "BTCUSDT"
    interval: str = "1d"
    lookback: int = 120
    pred_len: int = 5
    samples: int = 8

@app.get("/health")
def health():
    return {"ok": True, "model": "Kronos-base", "device": "cpu"}

@app.post("/forecast")
def forecast(req: Req):
    try:
        if req.market == "forex":
            df = yahoo_ohlcv(req.symbol, req.interval, "2y")
        else:
            df = binance_klines(req.symbol, req.interval, max(req.lookback + 10, 300))
        if len(df) < 60:
            return {"ok": False, "error": f"yetersiz veri ({len(df)})"}
        lookback = min(req.lookback, len(df) - 1, 480)
        cols = ["open", "high", "low", "close", "volume", "amount"]
        x_df = df[cols].iloc[-lookback:].reset_index(drop=True)
        x_ts = df["timestamps"].iloc[-lookback:].reset_index(drop=True)
        y_ts = future_index(df["timestamps"].iloc[-1], req.pred_len, req.interval)
        last_close = float(x_df["close"].iloc[-1])
        rounds = max(4, min(req.samples if req.samples and req.samples <= 12 else 8, 12))
        sc = 5  # her tahminde içeride ortalanan örnek sayısı (kararlılık için)
        finals = []
        for _ in range(rounds):
            pred = _predictor.predict(df=x_df, x_timestamp=x_ts, y_timestamp=y_ts,
                                      pred_len=req.pred_len, T=0.7, top_p=0.9, sample_count=sc, verbose=False)
            finals.append(float(pred["close"].iloc[-1]))
        finals = np.array(finals)
        mean_final = float(np.median(finals))
        prob_up = float((finals > last_close).mean())
        change_pct = (mean_final - last_close) / last_close * 100
        lo, hi = float(np.percentile(finals, 10)), float(np.percentile(finals, 90))
        return {
            "ok": True, "symbol": req.symbol, "interval": req.interval,
            "horizon": req.pred_len, "samples": len(finals),
            "last_close": round(last_close, 6), "expected_close": round(mean_final, 6),
            "expected_change_pct": round(change_pct, 2),
            "prob_up": round(prob_up, 2),
            "range_p10_p90": [round(lo, 6), round(hi, 6)],
            "direction": "YUKARI" if change_pct > 0 else "AŞAĞI",
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
