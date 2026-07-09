'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface Entry {
  ts: number;
  voice_state: string;
  responses: number;
  tools: number;
  cost_today: number;
  agent_running: boolean;
}

export function ReplayClient() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<number | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/replay/timeline?since=0`).then((r) => r.json())
      .then((j) => setEntries(j.entries || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (scrubIdx === null) setScrubIdx(0);
    playRef.current = window.setInterval(() => {
      setScrubIdx((i) => {
        if (i === null) return 0;
        if (i >= entries.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 200);
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [playing, entries.length, scrubIdx]);

  const current = scrubIdx != null ? entries[scrubIdx] : entries[entries.length - 1];

  const stats = useMemo(() => {
    if (!entries.length) return null;
    const totalResp = entries.reduce((a, e) => a + e.responses, 0);
    const totalTools = entries.reduce((a, e) => a + e.tools, 0);
    const peakCost = Math.max(...entries.map((e) => e.cost_today));
    return { totalResp, totalTools, peakCost };
  }, [entries]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 14, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
        display: 'flex', gap: 12, alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ REPLAY · 24H TIMELINE</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{entries.length} snapshots</span>
        {stats && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            · {stats.totalResp} responses · {stats.totalTools} tool calls · peak ${stats.peakCost.toFixed(4)}
          </span>
        )}
        <button
          onClick={() => setPlaying((p) => !p)}
          style={{
            marginLeft: 'auto', padding: '6px 14px', fontSize: 11, letterSpacing: '0.14em',
            background: playing ? 'rgba(255,80,80,0.18)' : 'rgba(0,212,255,0.15)',
            border: `1px solid ${playing ? '#ff6688' : 'var(--hud-cyan)'}`,
            color: playing ? '#ff6688' : 'var(--hud-cyan)', borderRadius: 4, cursor: 'pointer',
            fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
          }}
        >{playing ? '⏸ PAUSE' : '▶ PLAY'}</button>
      </div>

      <div style={{
        flex: 1, padding: 16, borderRadius: 6,
        background: 'radial-gradient(ellipse at center, rgba(0,30,60,0.5) 0%, rgba(0,5,15,0.95) 100%)',
        border: '1px solid rgba(var(--hud-rgb),0.18)',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {/* Big snapshot card */}
        {current ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <SnapStat label="TIMESTAMP" value={new Date(current.ts).toLocaleString('tr-TR')} mono />
            <SnapStat label="RESPONSES" value={String(current.responses)} color="var(--hud-cyan)" />
            <SnapStat label="TOOL CALLS" value={String(current.tools)} color="#fbbf24" />
            <SnapStat label="COST $" value={current.cost_today.toFixed(4)} color="#34d399" />
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            Henüz snapshot yok. Replay buffer her 60s'de bir kayıt alır — birkaç dakika bekle.
          </div>
        )}

        {/* Sparkline */}
        {entries.length > 0 && (
          <div style={{ flex: 1, position: 'relative' }}>
            <Sparkline entries={entries} field="responses" color="#00d4ff" label="Responses/min" />
            <Sparkline entries={entries} field="tools" color="#fbbf24" label="Tool calls" offsetTop={80} />
            <Sparkline entries={entries} field="cost_today" color="#34d399" label="Cost ($)" offsetTop={160} />
          </div>
        )}

        {/* Scrub bar */}
        {entries.length > 0 && (
          <input
            type="range" min={0} max={entries.length - 1}
            value={scrubIdx ?? entries.length - 1}
            onChange={(e) => { setScrubIdx(parseInt(e.target.value, 10)); setPlaying(false); }}
            style={{ width: '100%', accentColor: 'var(--hud-cyan)' }}
          />
        )}
      </div>
    </div>
  );
}

function SnapStat({ label, value, color = 'var(--text-primary)', mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div style={{ padding: 10, borderRadius: 4, background: 'rgba(0,8,20,0.5)', border: '1px solid rgba(var(--hud-rgb),0.2)', textAlign: 'center' }}>
      <div style={{ fontSize: mono ? 11 : 18, fontWeight: 700, color, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
      <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--text-secondary)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Sparkline({ entries, field, color, label, offsetTop = 0 }: {
  entries: Entry[]; field: keyof Entry; color: string; label: string; offsetTop?: number;
}) {
  const values = entries.map((e) => Number(e[field] || 0));
  const max = Math.max(0.01, ...values);
  const w = 800, h = 70;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0, height: 70 }}>
      <div style={{ position: 'absolute', top: 0, left: 0, fontSize: 9, letterSpacing: '0.14em', color, opacity: 0.7, zIndex: 2 }}>
        {label.toUpperCase()} · max {max.toFixed(field === 'cost_today' ? 4 : 0)}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.4" />
        <polygon points={`0,${h} ${points} ${w},${h}`} fill={color} opacity={0.1} />
      </svg>
    </div>
  );
}
