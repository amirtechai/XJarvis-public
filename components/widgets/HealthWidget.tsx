'use client';

import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

import { BACKEND } from '@/lib/backend';

interface Whoop {
  recovery: number | null;
  hrv: number | null;
  rhr: number | null;
  strain: number | null;
  sleep_perf: number | null;
  error?: string;
}

export function HealthWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [data, setData] = useState<Whoop | null>(null);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/whoop/summary`);
        if (r.ok) setData(await r.json());
      } catch { /* offline */ }
    };
    tick();
    const t = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const recColor = (v: number | null) =>
    v == null ? '#71717a' : v >= 67 ? '#34d399' : v >= 34 ? '#facc15' : '#ef4444';

  return (
    <WidgetShell title="Health" position={position} width={170}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.55rem', width: '100%', fontFamily: 'monospace' }}>
        {data?.error ? (
          <span style={{ opacity: 0.5, fontSize: '0.55rem' }}>WHOOP token missing</span>
        ) : (
          <>
            <Row label="RECOVERY" value={data?.recovery != null ? `${data.recovery}%` : '—'} color={recColor(data?.recovery ?? null)} />
            <Row label="SLEEP"    value={data?.sleep_perf != null ? `${data.sleep_perf}%` : '—'} />
            <Row label="HRV"      value={data?.hrv != null ? `${data.hrv}ms` : '—'} />
            <Row label="RHR"      value={data?.rhr != null ? `${data.rhr}bpm` : '—'} />
            <Row label="STRAIN"   value={data?.strain != null ? `${data.strain.toFixed(1)}` : '—'} />
          </>
        )}
      </div>
    </WidgetShell>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ opacity: 0.6, letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ color: color || 'var(--hud-cyan, #00d4ff)' }}>{value}</span>
    </div>
  );
}
