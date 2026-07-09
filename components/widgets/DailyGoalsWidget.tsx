'use client';
import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

import { BACKEND } from '@/lib/backend';

interface Goal {
  id: number;
  title: string;
  progress_pct: number;
  deadline?: string;
  status: string;
}

export function DailyGoalsWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/goals`, { cache: 'no-store' });
        if (r.ok && alive) {
          const all: Goal[] = await r.json();
          setGoals(all.filter((g) => g.status !== 'archived').slice(0, 4));
        }
      } catch { /* offline */ }
    };
    tick();
    const id = setInterval(tick, 2 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <WidgetShell title="Goals" position={position} width={220} height={180}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.6rem', width: '100%', textAlign: 'left' }}>
        {goals === null && <span style={{ opacity: 0.5 }}>loading…</span>}
        {goals && goals.length === 0 && <span style={{ opacity: 0.5 }}>aktif hedef yok</span>}
        {goals?.map((g) => {
          const pct = Math.max(0, Math.min(100, g.progress_pct ?? 0));
          const color = pct >= 80 ? '#34d399' : pct >= 40 ? '#facc15' : 'var(--hud-cyan, #00d4ff)';
          return (
            <div key={g.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{g.title}</span>
                <span style={{ color, fontFamily: 'monospace' }}>{pct}%</span>
              </div>
              <div style={{ height: 3, background: '#27272a', borderRadius: 2, marginTop: 2 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 400ms' }} />
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
