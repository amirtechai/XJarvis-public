'use client';

import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

const CITIES: { name: string; tz: string }[] = [
  { name: 'IST', tz: 'Europe/Istanbul' },
  { name: 'LON', tz: 'Europe/London' },
  { name: 'NYC', tz: 'America/New_York' },
  { name: 'TYO', tz: 'Asia/Tokyo' },
  { name: 'MUM', tz: 'Asia/Kolkata' },
];

export function WorldClocksWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <WidgetShell title="World" position={position}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.55rem', width: '100%', fontFamily: 'monospace' }}>
        {CITIES.map((c) => {
          const t = now.toLocaleTimeString('en-US', { timeZone: c.tz, hour: '2-digit', minute: '2-digit', hour12: false });
          return (
            <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.7, letterSpacing: '0.08em' }}>{c.name}</span>
              <span style={{ color: 'var(--hud-cyan, #00d4ff)' }}>{t}</span>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
