"""Crypto price + Binance portfolio + price alerts (via backend watcher)."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time

import httpx

from .base import ToolSpec, registry

BINANCE_BASE = "https://api.binance.com"
BACKEND = "http://127.0.0.1:3001"


# ---------- Public market data ----------

async def crypto_price(symbols: str = "BTCUSDT,ETHUSDT,SOLUSDT") -> str:
    """Get current price for one or more symbols (comma-separated, e.g. 'BTCUSDT,ETHUSDT')."""
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return "ERROR: no symbols"
    # Binance is strict: symbols param must be a compact JSON array, no spaces
    sym_param = json.dumps(syms, separators=(",", ":"))
    async with httpx.AsyncClient(timeout=10.0) as c:
        try:
            r = await c.get(f"{BINANCE_BASE}/api/v3/ticker/price?symbols={sym_param}")
        except httpx.HTTPError as e:
            return f"ERROR: {e}"
    if r.status_code != 200:
        return f"ERROR {r.status_code}: {r.text[:200]}"
    data = r.json()
    if isinstance(data, dict):
        data = [data]
    lines = []
    for d in data:
        sym = d.get("symbol", "?")
        price = d.get("price", "?")
        try:
            lines.append(f"{sym}: ${float(price):,.4f}")
        except (TypeError, ValueError):
            lines.append(f"{sym}: {price}")
    return "\n".join(lines)


async def crypto_24h(symbol: str = "BTCUSDT") -> str:
    """24h price change & volume for a single symbol."""
    sym = symbol.strip().upper()
    async with httpx.AsyncClient(timeout=10.0) as c:
        try:
            r = await c.get(f"{BINANCE_BASE}/api/v3/ticker/24hr", params={"symbol": sym})
        except httpx.HTTPError as e:
            return f"ERROR: {e}"
    if r.status_code != 200:
        return f"ERROR {r.status_code}: {r.text[:200]}"
    d = r.json()
    last = float(d.get("lastPrice", 0))
    pct = float(d.get("priceChangePercent", 0))
    high = float(d.get("highPrice", 0))
    low = float(d.get("lowPrice", 0))
    vol = float(d.get("quoteVolume", 0))
    arrow = "▲" if pct >= 0 else "▼"
    return (
        f"{sym} ${last:,.4f} {arrow}{pct:+.2f}% (24h)\n"
        f"  H ${high:,.4f}  L ${low:,.4f}  Vol ${vol:,.0f}"
    )


# ---------- Authenticated: portfolio ----------

def _sign(params: dict, secret: str) -> str:
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    sig = hmac.new(secret.encode(), qs.encode(), hashlib.sha256).hexdigest()
    return f"{qs}&signature={sig}"


async def binance_portfolio(min_usd: float = 1.0) -> str:
    """List Binance spot balances worth more than min_usd. Needs BINANCE_API_KEY + BINANCE_SECRET."""
    key = os.getenv("BINANCE_API_KEY", "").strip()
    secret = os.getenv("BINANCE_SECRET", "").strip()
    if not key or not secret:
        return "ERROR: BINANCE_API_KEY + BINANCE_SECRET env required"

    params = {"timestamp": int(time.time() * 1000), "recvWindow": 5000}
    qs = _sign(params, secret)
    headers = {"X-MBX-APIKEY": key}

    async with httpx.AsyncClient(timeout=15.0) as c:
        try:
            r = await c.get(f"{BINANCE_BASE}/api/v3/account?{qs}", headers=headers)
        except httpx.HTTPError as e:
            return f"ERROR: {e}"
        if r.status_code != 200:
            return f"ERROR {r.status_code}: {r.text[:200]}"
        data = r.json()
        balances = [b for b in (data.get("balances") or [])
                    if float(b["free"]) + float(b["locked"]) > 0]

        # Get prices for all assets vs USDT
        assets = sorted({b["asset"] for b in balances if b["asset"] != "USDT"})
        if not assets:
            prices = {}
        else:
            symbols = [a + "USDT" for a in assets]
            sym_param = json.dumps(symbols, separators=(",", ":"))
            try:
                pr = await c.get(f"{BINANCE_BASE}/api/v3/ticker/price?symbols={sym_param}")
                pricelist = pr.json() if pr.status_code == 200 else []
                if isinstance(pricelist, dict):
                    pricelist = [pricelist]
                prices = {p["symbol"]: float(p["price"]) for p in pricelist}
            except Exception:
                prices = {}

    rows = []
    total = 0.0
    for b in balances:
        amt = float(b["free"]) + float(b["locked"])
        asset = b["asset"]
        if asset == "USDT":
            usd = amt
        else:
            usd = amt * prices.get(asset + "USDT", 0)
        if usd < min_usd:
            continue
        total += usd
        rows.append((asset, amt, usd))

    rows.sort(key=lambda x: -x[2])
    if not rows:
        return f"(min_usd=${min_usd} üstü bakiye yok)"

    lines = [f"Portföy toplam: ${total:,.2f}"]
    for asset, amt, usd in rows:
        pct = 100 * usd / total if total > 0 else 0
        lines.append(f"  {asset}: {amt:.6f} ≈ ${usd:,.2f} ({pct:.1f}%)")
    return "\n".join(lines)


# ---------- Alerts (delegates to backend watcher) ----------

async def crypto_alert_set(symbol: str, op: str, price: float, note: str = "") -> str:
    """Set a one-shot price alert. op: 'above' | 'below'. Backend watcher pings Telegram on trigger."""
    if op not in ("above", "below"):
        return "ERROR: op must be 'above' or 'below'"
    async with httpx.AsyncClient(timeout=5.0) as c:
        try:
            r = await c.post(
                f"{BACKEND}/api/finance/alerts",
                json={"symbol": symbol.upper(), "op": op, "price": float(price), "note": note},
            )
        except httpx.HTTPError as e:
            return f"ERROR: {e}"
    if r.status_code != 200:
        return f"ERROR {r.status_code}: {r.text[:200]}"
    return f"OK: {symbol.upper()} {op} ${price} (id={r.json().get('id','?')})"


async def crypto_alert_list() -> str:
    async with httpx.AsyncClient(timeout=5.0) as c:
        try:
            r = await c.get(f"{BACKEND}/api/finance/alerts")
        except httpx.HTTPError as e:
            return f"ERROR: {e}"
    if r.status_code != 200:
        return f"ERROR {r.status_code}"
    alerts = r.json().get("alerts", [])
    if not alerts:
        return "(alarm yok)"
    return "\n".join(
        f"#{a['id']} {a['symbol']} {a['op']} ${a['price']}{(' — ' + a['note']) if a.get('note') else ''}"
        for a in alerts
    )


async def crypto_alert_delete(alert_id: int) -> str:
    async with httpx.AsyncClient(timeout=5.0) as c:
        try:
            r = await c.request("DELETE", f"{BACKEND}/api/finance/alerts", json={"id": int(alert_id)})
        except httpx.HTTPError as e:
            return f"ERROR: {e}"
    return f"OK ({r.status_code})" if r.status_code == 200 else f"ERROR {r.status_code}"


for spec in [
    ToolSpec(
        name="crypto_price",
        description="Binance spot fiyatları. symbols virgülle ayrılmış (örn 'BTCUSDT,ETHUSDT').",
        parameters={"type": "object", "properties": {"symbols": {"type": "string"}}},
        fn=crypto_price,
    ),
    ToolSpec(
        name="crypto_24h",
        description="24 saatlik fiyat değişimi + hacim (tek sembol).",
        parameters={
            "type": "object",
            "properties": {"symbol": {"type": "string"}},
            "required": ["symbol"],
        },
        fn=crypto_24h,
    ),
    ToolSpec(
        name="binance_portfolio",
        description=(
            "Binance spot bakiyelerini USD karşılıklarıyla listele. min_usd üstü tutuluyor. "
            "BINANCE_API_KEY + BINANCE_SECRET env gerekli."
        ),
        parameters={
            "type": "object",
            "properties": {"min_usd": {"type": "number"}},
        },
        fn=binance_portfolio,
    ),
    ToolSpec(
        name="crypto_alert_set",
        description="Tek-seferlik fiyat alarmı kur. op: 'above' veya 'below'. Tetiklendiğinde Telegram'a ping gider.",
        parameters={
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "op": {"type": "string", "enum": ["above", "below"]},
                "price": {"type": "number"},
                "note": {"type": "string"},
            },
            "required": ["symbol", "op", "price"],
        },
        fn=crypto_alert_set,
    ),
    ToolSpec(
        name="crypto_alert_list",
        description="Aktif fiyat alarmlarını listele.",
        parameters={"type": "object", "properties": {}},
        fn=crypto_alert_list,
    ),
    ToolSpec(
        name="crypto_alert_delete",
        description="Bir alarmı sil (id ile).",
        parameters={
            "type": "object",
            "properties": {"alert_id": {"type": "integer"}},
            "required": ["alert_id"],
        },
        fn=crypto_alert_delete,
    ),
]:
    registry.register(spec)
