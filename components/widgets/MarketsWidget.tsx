'use client';
import { BACKEND } from '@/lib/backend';
import { WidgetShell } from './WidgetShell';
import { usePolling } from '@/hooks/usePolling';

interface IndexRow { name: string; price: number; change: number; }

const SYMBOLS: { name: string; symbol: string }[] = [
  { name: 'S&P 500', symbol: '%5EGSPC' },
  { name: 'NASDAQ', symbol: '%5EIXIC' },
  { name: 'BIST 100', symbol: 'XU100.IS' },
  { name: 'DAX', symbol: '%5EGDAXI' },
  { name: 'FTSE', symbol: '%5EFTSE' },
  { name: 'Nikkei', symbol: '%5EN225' },
];

async function fetchMarkets(): Promise<IndexRow[]> {
  // Server-side proxy — Yahoo blocks browser CORS.
  const symbolList = SYMBOLS.map((s) => s.symbol).join(',');
  const r = await fetch(`${BACKEND}/api/markets/indices?symbols=${symbolList}`);
  if (!r.ok) throw new Error('markets fetch failed');
  const d = await r.json();
  const results = d?.results ?? [];
  return SYMBOLS.map((s, i) => {
    const q = results[i] ?? {};
    return {
      name: s.name,
      price: q.price ?? 0,
      change: q.change ?? 0,
    };
  });
}

export function MarketsWidget({ position }: { position: { bottom?: string; left?: string; right?: string } }) {
  const { data, cached } = usePolling(fetchMarkets, 120_000, 'jarvis:markets');

  return (
    <WidgetShell title="Indices" position={position} width={180} height={180}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontSize: '0.55rem', width: '100%' }}>
        {data?.map((r) => (
          <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ opacity: 0.7 }}>{r.name}</span>
            <span style={{ color: r.change > 0 ? 'var(--hud-emerald)' : r.change < 0 ? 'var(--hud-red)' : 'var(--hud-cyan)' }}>
              {r.change > 0 ? '+' : ''}{r.change.toFixed(2)}%
            </span>
          </div>
        ))}
        {!data && <span style={{ opacity: 0.5 }}>loading…</span>}
        {cached && <span style={{ fontSize: '0.5rem', opacity: 0.5 }}>⚠ cached</span>}
      </div>
    </WidgetShell>
  );
}
