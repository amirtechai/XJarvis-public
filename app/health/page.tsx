'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface ServiceStatus { up: boolean; port?: number }
interface CrashSvc {
  label: string;
  installed: boolean;
  pid?: number | null;
  last_exit?: number | null;
  running?: boolean;
  error_size?: number;
  error_mtime?: number | null;
  error_tail?: string;
  restart_hits_in_tail?: number;
}

interface HealthData {
  timestamp: number;
  services: { backend: ServiceStatus; agent: ServiceStatus; voice: ServiceStatus; vision: ServiceStatus };
  metrics: {
    spend_usd_today: number;
    daily_cap_usd: number;
    tools_count: number;
    latency_p50_ms?: number;
    latency_p95_ms?: number;
    ttft_p50_ms?: number;
  } | null;
  watchers: Record<string, Record<string, unknown>>;
  mcp: { name: string; mtime_age_sec: number; fresh: boolean; size: number }[];
  keys: Record<string, boolean>;
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [crash, setCrash] = useState<{ services: CrashSvc[] } | null>(null);
  const [crashOpen, setCrashOpen] = useState<string | null>(null);
  const [reportPath, setReportPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${BACKEND}/api/health/all`),
        fetch(`${BACKEND}/api/crash/state`),
      ]);
      if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
      const j = (await r1.json()) as HealthData;
      setData(j);
      if (r2.ok) setCrash(await r2.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const sendReport = async () => {
    setReportPath(null);
    try {
      const r = await fetch(`${BACKEND}/api/crash/report`, { method: 'POST' });
      const j = await r.json();
      if (j.ok) setReportPath(j.path);
    } catch {}
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <main style={{
      minHeight: '100vh', padding: '2rem',
      background: 'radial-gradient(circle at 50% 0%, #0a1424 0%, #050a14 70%)',
      color: 'var(--hud-cyan, #00d4ff)', fontFamily: 'var(--font-orbitron, monospace)',
    }}>
      <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '1.25rem', letterSpacing: '0.3em' }}>HEALTH</div>
            <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: 4 }}>
              {data ? `Güncellendi ${new Date(data.timestamp * 1000).toLocaleTimeString('tr-TR')}` : '—'} · 5s otomatik yenileme
            </div>
          </div>
          <button onClick={load} disabled={loading} style={refreshBtn}>↻</button>
        </header>

        {error && <div style={{ ...card, color: '#ef4444' }}>{error}</div>}

        {data && (
          <>
            <section style={card}>
              <div style={sectionTitle}>SERVICES</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                {Object.entries(data.services).map(([name, s]) => (
                  <Dot key={name} label={name} ok={s.up} sub={s.port ? `:${s.port}` : ''} />
                ))}
              </div>
            </section>

            {data.metrics && (
              <section style={card}>
                <div style={sectionTitle}>METRICS (60dk)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, fontSize: '0.85rem' }}>
                  <Stat label="Bugünkü harcama" value={`$${data.metrics.spend_usd_today.toFixed(4)} / $${data.metrics.daily_cap_usd}`} />
                  <Stat label="Tool sayısı" value={String(data.metrics.tools_count)} />
                  <Stat label="Latency p50" value={data.metrics.latency_p50_ms ? `${data.metrics.latency_p50_ms} ms` : '—'} />
                  <Stat label="Latency p95" value={data.metrics.latency_p95_ms ? `${data.metrics.latency_p95_ms} ms` : '—'} />
                  <Stat label="TTFT p50" value={data.metrics.ttft_p50_ms ? `${data.metrics.ttft_p50_ms} ms` : '—'} />
                </div>
              </section>
            )}

            <section style={card}>
              <div style={sectionTitle}>WATCHERS</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                {Object.entries(data.watchers).map(([name, w]) => {
                  const enabled = (w.enabled as boolean) ?? (w.up as boolean) ?? false;
                  const detail = describeWatcher(name, w);
                  return <Dot key={name} label={name.replace(/_/g, ' ')} ok={enabled} sub={detail} />;
                })}
              </div>
            </section>

            <section style={card}>
              <div style={sectionTitle}>MCP SERVERS · son log</div>
              {data.mcp.length === 0 && <div style={{ fontSize: '0.85rem', opacity: 0.5 }}>(log yok)</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {data.mcp.map((m) => (
                  <Dot key={m.name} label={m.name} ok={m.fresh} sub={`${formatAge(m.mtime_age_sec)}`} />
                ))}
              </div>
            </section>

            {crash && (
              <section style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={sectionTitle}>LAUNCHD · CRASH</div>
                  <button onClick={sendReport} style={refreshBtn} title="Diagnostik raporunu dosyaya yaz">📄</button>
                </div>
                {reportPath && (
                  <div style={{ fontSize: '0.75rem', color: '#34d399', marginBottom: 10, fontFamily: 'monospace' }}>
                    ✓ rapor yazıldı → {reportPath}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {crash.services.map((s) => {
                    const ok = s.installed && s.running && s.last_exit === 0;
                    const open = crashOpen === s.label;
                    return (
                      <div key={s.label}>
                        <div
                          onClick={() => setCrashOpen(open ? null : s.label)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '0.55rem 0.75rem', cursor: 'pointer',
                            background: ok ? 'rgba(52,211,153,0.07)' : s.installed ? 'rgba(245,158,11,0.07)' : 'rgba(239,68,68,0.07)',
                            border: `1px solid ${ok ? 'rgba(52,211,153,0.3)' : s.installed ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,
                            borderRadius: 8,
                          }}
                        >
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: ok ? '#34d399' : s.installed ? '#f59e0b' : '#ef4444',
                          }} />
                          <span style={{ flex: 1, fontSize: '0.85rem', fontFamily: 'monospace' }}>{s.label}</span>
                          <span style={{ fontSize: '0.65rem', opacity: 0.7, fontFamily: 'monospace' }}>
                            {s.installed ? `pid:${s.pid ?? '—'} · exit:${s.last_exit ?? '—'}` : 'kurulu değil'}
                          </span>
                        </div>
                        {open && s.error_tail && (
                          <pre style={{
                            marginTop: 4, padding: '0.5rem 0.7rem',
                            background: 'rgba(0,0,0,0.4)',
                            border: '1px solid rgba(239,68,68,0.15)',
                            borderRadius: 6, fontSize: '0.7rem',
                            color: '#fca5a5', maxHeight: 220, overflow: 'auto',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            fontFamily: 'monospace',
                          }}>{s.error_tail.slice(-3000)}</pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section style={card}>
              <div style={sectionTitle}>API KEYS</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {Object.entries(data.keys).map(([k, present]) => (
                  <Dot key={k} label={k.replace(/_/g, ' ').toLowerCase()} ok={present} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Dot({ label, ok, sub }: { label: string; ok: boolean; sub?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0.55rem 0.75rem',
      background: ok ? 'rgba(52,211,153,0.07)' : 'rgba(239,68,68,0.07)',
      border: `1px solid ${ok ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
      borderRadius: 8,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: ok ? '#34d399' : '#ef4444',
        boxShadow: `0 0 6px ${ok ? '#34d399' : '#ef4444'}`,
      }} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {sub && <span style={{ fontSize: '0.65rem', opacity: 0.6, fontFamily: 'monospace' }}>{sub}</span>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '0.5rem 0.7rem', background: 'rgba(var(--hud-rgb),0.05)', borderRadius: 6 }}>
      <div style={{ fontSize: '0.65rem', opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: '0.95rem', fontFamily: 'monospace', color: '#67e8f9' }}>{value}</div>
    </div>
  );
}

function describeWatcher(name: string, w: Record<string, unknown>): string {
  if (name === 'morning_brief' && w.time) return `${w.time}`;
  if (name === 'meeting_detector' && w.lead_minutes) return `${w.lead_minutes}dk önce`;
  if (name === 'inbox_sweeper' && w.interval_minutes) return `${w.interval_minutes}dk · ${w.last_archived ?? 0} arşiv`;
  if (name === 'reminders' && typeof w.pinged_count === 'number') return `${w.pinged_count} ping`;
  return '';
}

function formatAge(sec: number): string {
  if (sec < 60) return `${sec}s önce`;
  if (sec < 3600) return `${Math.round(sec / 60)}dk önce`;
  if (sec < 86400) return `${Math.round(sec / 3600)}sa önce`;
  return `${Math.round(sec / 86400)}gün önce`;
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(var(--hud-rgb),0.15)',
  borderRadius: 12, padding: '1rem 1.25rem',
};
const sectionTitle: React.CSSProperties = {
  fontSize: '0.7rem', letterSpacing: '0.2em', opacity: 0.7, marginBottom: 12,
};
const refreshBtn: React.CSSProperties = {
  background: 'transparent', color: 'var(--hud-cyan,#00d4ff)',
  border: '1px solid rgba(var(--hud-rgb),0.4)',
  width: 36, height: 36, borderRadius: 8, cursor: 'pointer', fontSize: 16,
};
