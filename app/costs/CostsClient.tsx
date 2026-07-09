'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface CostNow {
  ok: boolean;
  day: string;
  spend_usd_today: number;
  daily_cap_usd: number;
  tokens_in: number;
  tokens_out: number;
  by_model: Record<string, { spend: number; calls: number; tokens_in?: number; tokens_out?: number }>;
  top_prompts: Array<{ prompt: string; spend: number; model: string }>;
  week: Array<{ day: string; spend: number }>;
  error?: string;
}

export function CostsClient() {
  const [data, setData] = useState<CostNow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/cost/now`, { cache: 'no-store' });
        const j = await r.json();
        if (!alive) return;
        if (j.ok) { setData(j); setErr(null); } else setErr(j.error || 'no metrics');
      } catch (e) { if (alive) setErr((e as Error).message); }
    };
    tick();
    const t = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (err && !data) return <Centered>⚠ {err}</Centered>;
  if (!data) return <Centered>Yükleniyor…</Centered>;

  const pct = data.daily_cap_usd > 0 ? (data.spend_usd_today / data.daily_cap_usd) * 100 : 0;
  const pctColor = pct >= 100 ? '#ff5566' : pct >= 80 ? '#fbbf24' : '#34d399';

  const models = Object.entries(data.by_model || {}).sort((a, b) => (b[1]?.spend || 0) - (a[1]?.spend || 0));
  const weekMax = Math.max(0.01, ...data.week.map((w) => w.spend));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 20, gap: 16, background: 'var(--bg-base)' }}>
      <Header day={data.day} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <Stat label="BUGÜN" value={`$${data.spend_usd_today.toFixed(4)}`} color={pctColor} />
        <Stat label="CAP" value={`$${data.daily_cap_usd.toFixed(2)}`} color="var(--hud-cyan)" />
        <Stat label="KALAN" value={`$${Math.max(0, data.daily_cap_usd - data.spend_usd_today).toFixed(4)}`} color="var(--text-primary)" />
        <Stat label="KULLANIM" value={`${pct.toFixed(1)}%`} color={pctColor} />
      </div>

      <div style={{ height: 16, background: 'rgba(0,0,0,0.4)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{
          width: `${Math.min(100, pct)}%`, height: '100%',
          background: pctColor,
          transition: 'width 400ms ease',
        }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
        <Panel title={`MODEL DAĞILIMI (${models.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {models.length === 0 && <Empty>henüz veri yok</Empty>}
            {models.map(([name, info]) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                <span style={{ flex: 1, fontFamily: 'monospace', color: 'var(--hud-cyan)' }}>{name}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{info.calls || 0} call</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 700, minWidth: 70, textAlign: 'right' }}>
                  ${(info.spend || 0).toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="HAFTALIK">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140, padding: '0 4px' }}>
            {data.week.length === 0 && <Empty>—</Empty>}
            {data.week.map((w) => (
              <div key={w.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: '100%',
                  height: `${(w.spend / weekMax) * 100}%`,
                  minHeight: 2,
                  background: 'linear-gradient(180deg, var(--hud-cyan) 0%, rgba(0,150,200,0.3) 100%)',
                  borderRadius: '2px 2px 0 0',
                }} title={`$${w.spend.toFixed(4)}`} />
                <span style={{ fontSize: 8, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                  {w.day.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title={`EN PAHALI PROMPT'LAR (${data.top_prompts.length})`}>
        {data.top_prompts.length === 0 && <Empty>henüz veri yok</Empty>}
        {data.top_prompts.slice(0, 5).map((p, i) => (
          <div key={i} style={{
            padding: '8px 10px', borderRadius: 4, fontSize: 11, lineHeight: 1.4,
            background: 'rgba(0,0,0,0.3)', borderLeft: '3px solid #fbbf24', marginBottom: 6,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--hud-cyan)', fontFamily: 'monospace', fontSize: 10 }}>{p.model}</span>
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>${p.spend.toFixed(4)}</span>
            </div>
            <div style={{ color: 'var(--text-primary)' }}>
              {p.prompt.slice(0, 200)}{p.prompt.length > 200 ? '…' : ''}
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function Header({ day }: { day: string }) {
  return (
    <div className="hud-font" style={{
      padding: '10px 14px', borderRadius: 6,
      background: 'rgba(0,8,20,0.55)',
      border: '1px solid rgba(var(--hud-rgb),0.25)',
      display: 'flex', gap: 12, alignItems: 'center',
    }}>
      <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ COST DASHBOARD</span>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{day}</span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 6, background: 'rgba(0,8,20,0.45)', border: '1px solid rgba(var(--hud-rgb),0.18)', textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 9, letterSpacing: '0.22em', color: 'var(--text-secondary)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 14, borderRadius: 6,
      background: 'rgba(0,8,20,0.45)',
      border: '1px solid rgba(var(--hud-rgb),0.18)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
    }}>
      <div className="hud-font" style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--hud-cyan)', marginBottom: 10, fontWeight: 700 }}>
        {title}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 16, fontSize: 11, color: 'var(--text-secondary)', opacity: 0.5, textAlign: 'center' }}>{children}</div>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>{children}</div>;
}
