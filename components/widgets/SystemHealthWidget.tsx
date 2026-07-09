'use client';
import { BACKEND } from '@/lib/backend';
import { WidgetShell } from './WidgetShell';
import { usePolling } from '@/hooks/usePolling';

interface Stats {
  cpu: number;
  ram: number;
  temp: number | null;
  battery: number | null;
}

async function fetchStats(): Promise<Stats> {
  const r = await fetch(`${BACKEND}/api/system-stats`);
  if (!r.ok) throw new Error('stats fetch failed');
  return r.json();
}

function gaugeColor(pct: number) {
  if (pct < 60) return 'var(--hud-emerald)';
  if (pct < 80) return 'var(--hud-amber)';
  return 'var(--hud-red)';
}

function Gauge({ label, value }: { label: string; value: number }) {
  const r = 22, c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '0.5rem' }}>
      <svg width="50" height="50" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r={r} fill="none" stroke="rgba(var(--hud-rgb),0.15)" strokeWidth="3" />
        <circle
          cx="25" cy="25" r={r} fill="none" stroke={gaugeColor(value)} strokeWidth="3"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          transform="rotate(-90 25 25)"
        />
        <text x="25" y="28" textAnchor="middle" fill="var(--hud-cyan)" fontSize="9" fontFamily="var(--font-hud)">
          {value.toFixed(0)}
        </text>
      </svg>
      <span style={{ opacity: 0.7 }}>{label}</span>
    </div>
  );
}

export function SystemHealthWidget({ position }: { position: { bottom?: string; left?: string } }) {
  const { data, error } = usePolling(fetchStats, 5_000);

  return (
    <WidgetShell title="System" position={position}>
      {data ? (
        <>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <Gauge label="CPU%" value={data.cpu} />
            <Gauge label="RAM%" value={data.ram} />
          </div>
          <div style={{ fontSize: '0.5rem', opacity: 0.7, marginTop: '0.2rem' }}>
            {data.temp != null ? `${data.temp.toFixed(0)}°C` : '—'}
            {data.battery != null && ` · 🔋${data.battery.toFixed(0)}%`}
          </div>
        </>
      ) : (
        <span style={{ opacity: 0.5, fontSize: '0.55rem' }}>{error ? 'offline' : '…'}</span>
      )}
    </WidgetShell>
  );
}
