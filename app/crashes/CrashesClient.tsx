'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface ServiceState {
  label: string;
  pid?: number | null;
  last_exit?: number | null;
  running: boolean;
  error_tail?: string;
}

export function CrashesClient() {
  const [services, setServices] = useState<ServiceState[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportPath, setReportPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/crash/state`, { cache: 'no-store' });
      const j = await r.json();
      setServices(Array.isArray(j) ? j : (j.services || []));
    } catch { /* offline */ } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const writeReport = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${BACKEND}/api/crash/report`, { method: 'POST' });
      const j = await r.json();
      setReportPath(j.path || j.file || null);
    } finally { setBusy(false); }
  };

  const restart = async (label: string) => {
    await fetch(`${BACKEND}/api/services/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: label }),
    });
    setTimeout(load, 1500);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 12, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
        display: 'flex', gap: 12, alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ CRASH REPORT</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{services.length} service</span>
        <button
          onClick={writeReport} disabled={busy}
          style={{
            marginLeft: 'auto', padding: '6px 14px', fontSize: 11, letterSpacing: '0.14em',
            background: 'rgba(var(--hud-rgb),0.15)', border: '1px solid rgba(var(--hud-rgb),0.4)',
            color: 'var(--hud-cyan)', borderRadius: 4, cursor: 'pointer',
            fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
          }}
        >{busy ? '…' : '📄 RAPOR ÜRET'}</button>
      </div>

      {reportPath && (
        <div style={{ padding: 10, fontSize: 12, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 4, color: '#34d399', fontFamily: 'monospace' }}>
          ✓ Rapor: {reportPath}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>Yükleniyor…</div>}
        {!loading && services.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', opacity: 0.5, fontSize: 12 }}>
            Servis durumu alınamadı.
          </div>
        )}
        {services.map((s) => {
          const ok = s.running;
          const c = ok ? '#34d399' : '#ff5566';
          return (
            <div key={s.label} style={{
              padding: 14, borderRadius: 6,
              background: 'rgba(0,8,20,0.4)',
              border: `1px solid ${c}55`,
              borderLeft: `4px solid ${c}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: c }}>{s.label}</span>
                <span style={{
                  fontSize: 9, padding: '2px 8px', borderRadius: 10,
                  background: `${c}25`, border: `1px solid ${c}`, color: c,
                  letterSpacing: '0.1em', fontWeight: 700,
                }}>{ok ? '● RUNNING' : '○ DOWN'}</span>
                {s.pid != null && (
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                    PID {s.pid}
                  </span>
                )}
                {!ok && (
                  <button
                    onClick={() => restart(s.label)}
                    style={{
                      marginLeft: 'auto', padding: '4px 12px', fontSize: 10, letterSpacing: '0.14em',
                      background: 'rgba(0,212,255,0.15)', border: '1px solid var(--hud-cyan)',
                      color: 'var(--hud-cyan)', borderRadius: 4, cursor: 'pointer',
                      fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
                    }}
                  >▶ RESTART</button>
                )}
              </div>
              {s.error_tail && (
                <pre style={{
                  margin: 0, padding: 10, fontSize: 10, fontFamily: 'monospace',
                  background: 'rgba(0,0,0,0.4)', borderRadius: 4,
                  color: '#ff8888', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto',
                }}>{s.error_tail}</pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
