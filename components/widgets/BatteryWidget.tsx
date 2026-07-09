'use client';
import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

import { BACKEND } from '@/lib/backend';
const POLL_MS = 30_000;

interface Stats {
  cpu: number;
  ram: number;
  temp: number | null;
  battery: number | null;
}

export function BatteryWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    const fetch1 = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/system-stats`, { cache: 'no-store' });
        if (r.ok && alive) setS(await r.json());
      } catch { /* offline */ }
    };
    fetch1();
    const id = setInterval(fetch1, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const battery = s?.battery;
  const temp = s?.temp;
  const color = battery == null ? '#71717a' : battery >= 50 ? '#34d399' : battery >= 20 ? '#facc15' : '#ef4444';
  const display = battery == null ? '—' : `${Math.round(battery)}%`;

  return (
    <WidgetShell title="Battery" position={position}>
      <div style={{ fontSize: '1.1rem', color, fontFamily: 'monospace' }}>{display}</div>
      <div style={{
        width: '80%', height: 4, background: '#27272a', borderRadius: 2, marginTop: 4, overflow: 'hidden',
      }}>
        <div style={{ height: '100%', width: `${battery ?? 0}%`, background: color, transition: 'width 400ms' }} />
      </div>
      <div style={{ fontSize: '0.55rem', opacity: 0.7, marginTop: 4 }}>
        {temp != null ? `${temp.toFixed(0)}°C CPU` : 'no temp'}
      </div>
    </WidgetShell>
  );
}
