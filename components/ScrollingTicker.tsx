'use client';
import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface TickerItem {
  symbol: string;
  price?: number;
  change: number;
}

const STOCK_SYMBOLS = [
  { name: 'S&P 500',  symbol: '%5EGSPC' },
  { name: 'NASDAQ',   symbol: '%5EIXIC' },
  { name: 'DOW',      symbol: '%5EDJI' },
  { name: 'BIST 100', symbol: 'XU100.IS' },
  { name: 'DAX',      symbol: '%5EGDAXI' },
  { name: 'FTSE',     symbol: '%5EFTSE' },
  { name: 'Nikkei',   symbol: '%5EN225' },
];

export function ScrollingTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    let alive = true;

    const refresh = async () => {
      const out: TickerItem[] = [];
      // Stocks
      try {
        const sym = STOCK_SYMBOLS.map((s) => s.symbol).join(',');
        const r = await fetch(`${BACKEND}/api/markets/indices?symbols=${sym}`).then((x) => x.json());
        for (let i = 0; i < STOCK_SYMBOLS.length; i++) {
          const q = (r?.results || [])[i] || {};
          out.push({
            symbol: STOCK_SYMBOLS[i].name,
            price: q.price,
            change: q.change ?? 0,
          });
        }
      } catch {}
      // Crypto — CoinGecko (CORS açık, anahtar gerekmez)
      try {
        const ids = 'bitcoin,ethereum,solana,binancecoin,ripple';
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`).then((x) => x.json()).catch(() => null);
        if (r) {
          const map: Record<string, string> = {
            bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB', ripple: 'XRP',
          };
          for (const [k, label] of Object.entries(map)) {
            const q = r[k];
            if (q?.usd != null) {
              out.push({ symbol: label, price: q.usd, change: q.usd_24h_change ?? 0 });
            }
          }
        }
      } catch {}
      // FX — frankfurter (free, CORS)
      try {
        const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=TRY,EUR,GBP').then((x) => x.json()).catch(() => null);
        if (r?.rates) {
          if (r.rates.TRY) out.push({ symbol: 'USD/TRY', price: r.rates.TRY, change: 0 });
          if (r.rates.EUR) out.push({ symbol: 'USD/EUR', price: r.rates.EUR, change: 0 });
          if (r.rates.GBP) out.push({ symbol: 'USD/GBP', price: r.rates.GBP, change: 0 });
        }
      } catch {}
      if (alive && out.length) setItems(out);
    };

    refresh();
    const id = setInterval(refresh, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (items.length === 0) {
    return (
      <div style={{ height: 32, display: 'flex', alignItems: 'center', color: '#999', fontSize: 11, fontFamily: 'ui-monospace, monospace', padding: '0 16px' }}>
        Loading market data…
      </div>
    );
  }

  // Tek listeden 2x duplicate ile sürekli akış
  const loop = [...items, ...items];

  return (
    <div style={{
      width: '100%',
      height: 32,
      background: '#0a0a0a',
      borderTop: '1px solid rgba(var(--hud-rgb),0.3)',
      borderBottom: '1px solid rgba(var(--hud-rgb),0.3)',
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
    }}>
      <div style={{
        display: 'flex',
        whiteSpace: 'nowrap',
        animation: 'ticker-scroll 60s linear infinite',
      }}>
        {loop.map((it, i) => {
          const up = (it.change ?? 0) >= 0;
          const color = up ? '#00ff7f' : '#ff3939';
          const arrow = up ? '▲' : '▼';
          return (
            <div key={`${i}-${it.symbol}`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '0 22px',
              fontFamily: 'ui-monospace, "Courier New", monospace',
              fontSize: 13,
              color: '#ffffff',
              borderRight: '1px solid rgba(255,255,255,0.08)',
            }}>
              <span style={{ fontWeight: 700, color: '#ffd166', letterSpacing: '0.05em' }}>{it.symbol}</span>
              {it.price != null && (
                <span style={{ color: '#e6e6e6' }}>
                  {it.price.toFixed(it.price >= 1000 ? 2 : it.price >= 10 ? 2 : 4)}
                </span>
              )}
              <span style={{ color, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 10 }}>{arrow}</span>
                {Math.abs(it.change).toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
      <style jsx>{`
        @keyframes ticker-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
