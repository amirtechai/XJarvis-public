'use client';

import { useEffect, useState } from 'react';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES, type JarvisEvent } from '@/lib/events';
import { WidgetShell } from './WidgetShell';

interface MetricsResponse {
  spend_usd_today?: number;
  daily_cap_usd?: number;
  latency_60min?: {
    count?: number;
    total_p50?: number;
    total_p95?: number;
    ttft_p50?: number;
  };
}

function getLatency(e: JarvisEvent): { total_ms?: number; ttft_ms?: number | null } {
  const p = e.payload as { total_ms?: unknown; ttft_ms?: unknown };
  return {
    total_ms: typeof p?.total_ms === 'number' ? p.total_ms : undefined,
    ttft_ms: typeof p?.ttft_ms === 'number' ? p.ttft_ms : null,
  };
}

const REFRESH_MS = 10_000;
const AGENT_METRICS_URL = 'http://127.0.0.1:8767/metrics';

interface Props {
  position?: { top?: string; bottom?: string; left?: string; right?: string };
}

export function LatencyWidget({ position }: Props = {}) {
  const { lastEvent } = useJarvisEvents([EVENT_TYPES.TURN_LATENCY]);
  const [m, setM] = useState<MetricsResponse>({});

  useEffect(() => {
    let alive = true;
    const fetchM = async () => {
      try {
        const r = await fetch(AGENT_METRICS_URL, { cache: 'no-store' });
        if (!r.ok) return;
        const data = (await r.json()) as MetricsResponse;
        if (alive) setM(data);
      } catch {
        /* agent offline — keep previous */
      }
    };
    fetchM();
    const id = setInterval(fetchM, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Re-fetch right after a fresh latency event
  useEffect(() => {
    if (lastEvent?.event !== EVENT_TYPES.TURN_LATENCY) return;
    const t = setTimeout(() => {
      fetch(AGENT_METRICS_URL).then((r) => r.json()).then(setM).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [lastEvent]);

  const lat = lastEvent ? getLatency(lastEvent) : { total_ms: undefined, ttft_ms: null };
  const lastTotal = lat.total_ms;
  const lastTtft = lat.ttft_ms ?? undefined;
  const stats = m.latency_60min ?? {};
  const spend = m.spend_usd_today ?? 0;
  const cap = m.daily_cap_usd ?? 0;
  const spendPct = cap ? Math.min(100, (spend / cap) * 100) : 0;

  return (
    <WidgetShell title="Latency / Cost" position={position} width={220} height={180}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.7rem', fontFamily: 'monospace', width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Stat label="last" value={lastTotal != null ? `${lastTotal} ms` : '—'} />
          <Stat label="TTFT" value={lastTtft != null ? `${lastTtft} ms` : '—'} />
          <Stat label="p50/60m" value={stats.total_p50 != null ? `${stats.total_p50} ms` : '—'} />
          <Stat label="p95/60m" value={stats.total_p95 != null ? `${stats.total_p95} ms` : '—'} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
            <span>${spend.toFixed(4)} / ${cap.toFixed(2)}</span>
            <span>{stats.count ?? 0} turns</span>
          </div>
          <div style={{ height: 4, background: '#27272a', borderRadius: 2 }}>
            <div
              style={{
                height: 4,
                width: `${spendPct}%`,
                background: spendPct > 80 ? '#ef4444' : '#fbbf24',
                borderRadius: 2,
              }}
            />
          </div>
        </div>
      </div>
    </WidgetShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ color: '#71717a' }}>{label}</span>
      <span style={{ color: 'var(--hud-cyan, #00d4ff)' }}>{value}</span>
    </div>
  );
}
