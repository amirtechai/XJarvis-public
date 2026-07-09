'use client';

import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

interface Now {
  player: string;
  title: string;
  artist: string;
  state: 'playing' | 'paused' | 'stopped';
}

import { BACKEND } from '@/lib/backend';

async function fetchNow(): Promise<Now | null> {
  try {
    const r = await fetch(`${BACKEND}/api/now-playing`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.title) return null;
    return j as Now;
  } catch { return null; }
}

async function control(action: 'play' | 'pause' | 'next' | 'prev') {
  await fetch(`${BACKEND}/api/now-playing/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  }).catch(() => {});
}

export function NowPlayingWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [data, setData] = useState<Now | null>(null);

  useEffect(() => {
    const tick = async () => setData(await fetchNow());
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, []);

  const playing = data?.state === 'playing';

  return (
    <WidgetShell title="Now Playing" position={position} width={260}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', fontSize: '0.65rem' }}>
        <div style={{
          fontSize: '0.7rem', fontWeight: 600,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: 'var(--hud-cyan, #00d4ff)',
        }}>{data?.title || '— no track —'}</div>
        <div style={{ fontSize: '0.55rem', opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {data?.artist || ''} {data?.player ? `· ${data.player}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <Btn onClick={() => control('prev')}>⏮</Btn>
          <Btn onClick={() => control(playing ? 'pause' : 'play')} accent>
            {playing ? '⏸' : '▶'}
          </Btn>
          <Btn onClick={() => control('next')}>⏭</Btn>
        </div>
      </div>
    </WidgetShell>
  );
}

function Btn({ onClick, children, accent }: { onClick: () => void; children: React.ReactNode; accent?: boolean }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '4px 0', fontSize: '0.7rem',
      background: accent ? 'rgba(var(--hud-rgb),0.18)' : 'transparent',
      border: '1px solid rgba(var(--hud-rgb),0.4)',
      color: 'var(--hud-cyan, #00d4ff)',
      borderRadius: 3, cursor: 'pointer',
    }}>{children}</button>
  );
}
