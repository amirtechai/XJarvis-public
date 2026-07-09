'use client';
import { WidgetShell } from './WidgetShell';
import { usePolling } from '@/hooks/usePolling';

interface PriceRow { symbol: string; price: number; change: number; }

async function fetchPrices(): Promise<PriceRow[]> {
  const cgUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';
  const fxUrl = 'https://open.er-api.com/v6/latest/USD';

  const [cgRes, fxRes] = await Promise.allSettled([
    fetch(cgUrl).then((r) => r.json()),
    fetch(fxUrl).then((r) => r.json()),
  ]);

  const rows: PriceRow[] = [];

  if (cgRes.status === 'fulfilled') {
    const d = cgRes.value as Record<string, { usd: number; usd_24h_change: number }>;
    if (d.bitcoin) rows.push({ symbol: 'BTC', price: d.bitcoin.usd, change: d.bitcoin.usd_24h_change });
    if (d.ethereum) rows.push({ symbol: 'ETH', price: d.ethereum.usd, change: d.ethereum.usd_24h_change });
  }

  if (fxRes.status === 'fulfilled') {
    const d = fxRes.value as { rates?: Record<string, number> };
    if (d.rates?.TRY) rows.push({ symbol: 'USD/TRY', price: d.rates.TRY, change: 0 });
    if (d.rates?.TRY && d.rates?.EUR) rows.push({ symbol: 'EUR/TRY', price: d.rates.TRY / d.rates.EUR, change: 0 });
  }

  return rows;
}

export function CryptoForexWidget({ position }: { position: { top?: string; right?: string } }) {
  const { data, cached, error } = usePolling(fetchPrices, 60_000, 'jarvis:crypto-forex');

  return (
    <WidgetShell title="Markets" position={position}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.6rem', width: '100%' }}>
        {data?.map((r) => (
          <div key={r.symbol} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem' }}>
            <span style={{ opacity: 0.7 }}>{r.symbol}</span>
            <span>{r.price > 100 ? r.price.toFixed(2) : r.price.toFixed(4)}</span>
            <span style={{ color: r.change > 0 ? 'var(--hud-emerald)' : r.change < 0 ? 'var(--hud-red)' : 'var(--hud-cyan)' }}>
              {r.change > 0 ? '▲' : r.change < 0 ? '▼' : '·'}{Math.abs(r.change).toFixed(1)}%
            </span>
          </div>
        ))}
        {!data && !error && <span style={{ opacity: 0.5 }}>loading…</span>}
        {cached && <span style={{ fontSize: '0.5rem', opacity: 0.5 }}>⚠ cached</span>}
      </div>
    </WidgetShell>
  );
}
