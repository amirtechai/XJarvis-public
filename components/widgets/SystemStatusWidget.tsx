'use client';
import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';

function fmtUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function SystemStatusWidget({ position }: { position: { top?: string; left?: string } }) {
  // Initialize to 0 to avoid SSR/CSR mismatch — real values set in effect.
  const [start, setStart] = useState(0);
  const [now, setNow] = useState(0);
  const { isConnected, eventHistory } = useJarvisEvents('*');

  useEffect(() => {
    const initial = Date.now();
    setStart(initial);
    setNow(initial);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const uptime = start === 0 ? 0 : now - start;

  const status: 'up' | 'degraded' | 'down' = !isConnected ? 'down' : 'up';
  const dotColor = status === 'up' ? 'var(--hud-emerald)' : status === 'down' ? 'var(--hud-red)' : 'var(--hud-amber)';

  return (
    <WidgetShell title="Status" position={position} width={220} height={200}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.55rem', alignItems: 'flex-start', width: '100%', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, boxShadow: `0 0 6px ${dotColor}` }} className="hud-pulse" />
          <span>{status === 'up' ? 'ALL SYSTEMS NOMINAL' : status.toUpperCase()}</span>
        </div>
        <div><span style={{ opacity: 0.6 }}>uptime:</span> {fmtUptime(uptime)}</div>
        <div><span style={{ opacity: 0.6 }}>ws:</span> {isConnected ? 'connected' : 'reconnecting…'}</div>
        <div><span style={{ opacity: 0.6 }}>events:</span> {eventHistory.length}</div>
      </div>
    </WidgetShell>
  );
}
