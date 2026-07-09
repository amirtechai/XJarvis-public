'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface ToolEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  started_at: number;
  finished_at: number | null;
  ok: boolean | null;
  output_brief?: string;
}

export function ToolsClient() {
  const [entries, setEntries] = useState<ToolEntry[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/tools/timeline`, { cache: 'no-store' });
        const j = await r.json();
        if (alive) setEntries(j.entries || []);
      } catch { /* noop */ }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const filtered = filter
    ? entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  const total = entries.length;
  const success = entries.filter((e) => e.ok === true).length;
  const failed = entries.filter((e) => e.ok === false).length;
  const running = entries.filter((e) => e.finished_at == null).length;
  const avgDuration = (() => {
    const closed = entries.filter((e) => e.finished_at != null);
    if (!closed.length) return 0;
    const sum = closed.reduce((a, e) => a + ((e.finished_at as number) - e.started_at), 0);
    return Math.round(sum / closed.length);
  })();

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 12, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        display: 'flex', gap: 16, alignItems: 'center',
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ TOOL TIMELINE</span>
        <Stat label="TOTAL" value={total} />
        <Stat label="OK" value={success} color="#34d399" />
        <Stat label="FAIL" value={failed} color="#ff8888" />
        <Stat label="LIVE" value={running} color="#fbbf24" />
        <Stat label="AVG" value={`${avgDuration}ms`} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          style={{
            marginLeft: 'auto', padding: '5px 10px', fontSize: 11,
            background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', borderRadius: 4, fontFamily: 'inherit',
            minWidth: 160,
          }}
        />
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4,
        background: 'rgba(0,8,20,0.4)', borderRadius: 6, padding: 8,
        border: '1px solid rgba(var(--hud-rgb),0.18)',
      }}>
        {filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)', opacity: 0.5 }}>
            Henüz tool çağrısı yok. XJarvis bir araç kullanınca burada akar.
          </div>
        )}
        {filtered.slice().reverse().map((e) => (
          <ToolRow key={e.id} entry={e} />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, color = 'var(--hud-cyan)' }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 50 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 8, letterSpacing: '0.18em', color: 'var(--text-secondary)', opacity: 0.7 }}>{label}</span>
    </div>
  );
}

function ToolRow({ entry: e }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false);
  const dur = e.finished_at ? e.finished_at - e.started_at : null;
  const status = e.finished_at == null ? 'running' : e.ok ? 'ok' : 'fail';
  const c = status === 'running' ? '#fbbf24' : status === 'ok' ? '#34d399' : '#ff8888';
  return (
    <div style={{
      padding: '6px 10px', borderRadius: 4,
      background: 'rgba(0,0,0,0.3)',
      borderLeft: `3px solid ${c}`,
      fontSize: 11, lineHeight: 1.4,
      cursor: 'pointer',
    }} onClick={() => setOpen(!open)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'ui-monospace, monospace' }}>
        <span style={{ color: 'var(--text-secondary)', minWidth: 70 }}>
          {new Date(e.started_at).toLocaleTimeString()}
        </span>
        <span style={{ color: c, fontWeight: 700, minWidth: 60 }}>{status.toUpperCase()}</span>
        <span style={{ color: 'var(--hud-cyan)', flex: 1, fontWeight: 600 }}>{e.name}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
          {dur != null ? `${dur}ms` : '…'}
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 6, paddingLeft: 78, fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          <div>args: {JSON.stringify(e.args)}</div>
          {e.output_brief && <div style={{ marginTop: 4, color: '#aaa' }}>out: {e.output_brief}</div>}
        </div>
      )}
    </div>
  );
}
