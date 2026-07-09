'use client';
import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

import { BACKEND } from '@/lib/backend';

interface Note { title: string; modified: string }

export function AppleNotesWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/app/notes/find?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const d = await r.json();
        if (!alive) return;
        if (!d.ok) { setError(d.error || 'fetch failed'); return; }
        setError(null);
        setNotes((d.matches || []).slice(0, 5));
      } catch (e) { if (alive) setError((e as Error).message); }
    };
    tick();
    const id = setInterval(tick, 2 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [q]);

  return (
    <WidgetShell title="Notes" position={position} width={220} height={180}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.6rem', width: '100%', textAlign: 'left' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ara…"
          style={{
            width: '100%',
            background: 'rgba(0,8,20,0.6)',
            border: '1px solid rgba(var(--hud-rgb),0.18)',
            borderRadius: 4,
            padding: '3px 6px',
            color: 'var(--text-primary)',
            fontSize: '0.6rem',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        {error && <span style={{ opacity: 0.6, color: '#ef4444' }}>{error}</span>}
        {!error && notes === null && <span style={{ opacity: 0.5 }}>loading…</span>}
        {!error && notes && notes.length === 0 && <span style={{ opacity: 0.5 }}>not yok</span>}
        {!error && notes?.map((n, i) => (
          <div key={i} style={{ borderBottom: '1px dashed rgba(var(--hud-rgb),0.1)', paddingBottom: 2 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title || '(başlıksız)'}</div>
            <div style={{ opacity: 0.5, fontSize: '0.5rem', fontFamily: 'monospace' }}>{(n.modified || '').slice(0, 16)}</div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
