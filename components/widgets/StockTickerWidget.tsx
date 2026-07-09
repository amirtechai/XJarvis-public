'use client';

import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

interface Tick { sym: string; price: number; change: number }

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

import { BACKEND } from '@/lib/backend';

export function StockTickerWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [data, setData] = useState<Tick[]>([]);

  useEffect(() => {
    const tick = async () => {
      try {
        const reqs = SYMBOLS.map((s) =>
          fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${s}`).then((r) => r.json()).catch(() => null),
        );
        const results = await Promise.all(reqs);
        const out: Tick[] = [];
        for (let i = 0; i < SYMBOLS.length; i++) {
          const j = results[i];
          if (!j || !j.lastPrice) continue;
          out.push({
            sym: SYMBOLS[i].replace('USDT', ''),
            price: parseFloat(j.lastPrice),
            change: parseFloat(j.priceChangePercent || '0'),
          });
        }
        setData(out);
      } catch { /* swallow */ }
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <WidgetShell title="Ticker" position={position} width={140}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.55rem', width: '100%', fontFamily: 'monospace' }}>
        {data.length === 0 && <span style={{ opacity: 0.5 }}>loading…</span>}
        {data.map((t) => (
          <div key={t.sym}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.7, letterSpacing: '0.08em' }}>{t.sym}</span>
              <span style={{ color: t.change >= 0 ? '#34d399' : '#ef4444' }}>
                {t.change > 0 ? '+' : ''}{t.change.toFixed(2)}%
              </span>
            </div>
            <div style={{ color: 'var(--hud-cyan, #00d4ff)', fontSize: '0.6rem' }}>
              ${t.price < 10 ? t.price.toFixed(4) : t.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}

// Suppress unused warning — backend var imported but not yet used (future proxy)
void BACKEND;
