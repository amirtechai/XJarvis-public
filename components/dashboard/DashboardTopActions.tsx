'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
function getInvoke(): Invoke | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } };
  return w.__TAURI_INTERNALS__?.invoke || null;
}

export function DashboardTopActions() {
  const [miniOrbOpen, setMiniOrbOpen] = useState(false);
  const [monitors, setMonitors] = useState<{ count: number; active: number }>({ count: 1, active: 1 });

  useEffect(() => {
    fetchMonitors();
    const t = setInterval(fetchMonitors, 8000);
    return () => clearInterval(t);
  }, []);

  const fetchMonitors = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/monitors/state`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setMonitors({ count: j.count || 1, active: j.active || 1 });
      }
    } catch { /* offline */ }
  };

  const setMonitorMode = async (count: 1 | 2 | 3 | 4 | -1) => {
    try {
      await fetch(`${BACKEND}/api/monitors/arrange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });
      fetchMonitors();
    } catch { /* noop */ }
  };

  const toggleMiniOrb = async () => {
    const invoke = getInvoke();
    if (!invoke) {
      alert('Mini orb sadece Tauri uygulamasında çalışır.');
      return;
    }
    try {
      const opening = !miniOrbOpen;
      await invoke('toggle_mini_orb', { onTop: true });
      setMiniOrbOpen((v) => !v);
      // Orb açılınca ana pencereyi Dock'a indir → XJarvis arkaplanda, orb önde.
      if (opening) await invoke('minimize_main_to_dock', {});
    } catch (e) {
      console.warn('mini orb error', e);
    }
  };

  const monitorBtns: Array<{ id: 1 | 2 | 3 | 4 | -1; label: string }> = [
    { id: 1, label: '1' },
    { id: 2, label: '2' },
    { id: 3, label: '3' },
    { id: 4, label: '4' },
    { id: -1, label: '∞' },
  ];

  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {/* Multi-monitor splitter */}
      <div style={pillBox}>
        <span style={pillLabel}>SCREENS</span>
        {monitorBtns.map((b) => (
          <button
            key={b.id}
            onClick={() => setMonitorMode(b.id)}
            title={b.id === -1 ? 'Tüm bağlı ekranlara yay' : `${b.id} pencere düzenine geç`}
            style={pillBtn(monitors.active === b.id)}
          >{b.label}</button>
        ))}
      </div>

      {/* Mini orb toggle */}
      <button
        onClick={toggleMiniOrb}
        title="Floating mini orb (always-on-top)"
        style={{
          ...pillBtn(miniOrbOpen),
          padding: '4px 10px', fontSize: 10,
        }}
      >🔮 MINI</button>
    </div>
  );
}

const pillBox: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 2, padding: 2,
  borderRadius: 4, background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(var(--hud-rgb),0.25)',
};
const pillLabel: React.CSSProperties = {
  fontSize: 8, letterSpacing: '0.18em', color: 'rgba(var(--hud-rgb),0.7)',
  padding: '0 6px', fontWeight: 700,
};
function pillBtn(active: boolean): React.CSSProperties {
  return {
    padding: '3px 8px', fontSize: 10, letterSpacing: '0.12em', fontWeight: 700,
    background: active ? 'rgba(var(--hud-rgb),0.28)' : 'transparent',
    border: 'none', borderRadius: 3,
    color: active ? '#00d4ff' : 'rgba(255,255,255,0.55)',
    cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
    minWidth: 22,
  };
}
