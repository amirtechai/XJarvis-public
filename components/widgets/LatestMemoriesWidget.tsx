'use client';
import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

import { BACKEND } from '@/lib/backend';

interface DaySummary {
  date: string;
  summary: string;
  key_facts?: string[];
}

export function LatestMemoriesWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [days, setDays] = useState<DaySummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/memory/recent?days=3`, { cache: 'no-store' });
        if (r.ok && alive) setDays(await r.json());
      } catch { /* offline */ }
    };
    tick();
    const id = setInterval(tick, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <WidgetShell title="Memories" position={position} width={240} height={200}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.55rem', width: '100%', textAlign: 'left' }}>
        {days === null && <span style={{ opacity: 0.5 }}>loading…</span>}
        {days && days.length === 0 && <span style={{ opacity: 0.5 }}>henüz özet yok</span>}
        {days?.slice(0, 3).map((d) => (
          <div key={d.date} style={{ borderLeft: '2px solid rgba(var(--hud-rgb),0.4)', paddingLeft: 6 }}>
            <div style={{ color: 'var(--hud-cyan, #00d4ff)', letterSpacing: '0.1em' }}>{d.date}</div>
            <div style={{ opacity: 0.85, lineHeight: 1.35 }}>
              {(d.summary || '').slice(0, 120)}{(d.summary || '').length > 120 ? '…' : ''}
            </div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
