'use client';

import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

import { BACKEND } from '@/lib/backend';
const POLL_MS = 2000;

interface ControlState {
  camera: { on: boolean; available: boolean };
  mic:    { on: boolean; available: boolean };
  jarvis: { on: boolean; available: boolean };
  volume: number | null;
}

interface Props {
  position?: { top?: string; bottom?: string; left?: string; right?: string };
}

export function ControlPanelWidget({ position }: Props = {}) {
  const [state, setState] = useState<ControlState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/control/state`, { cache: 'no-store' });
        if (r.ok && alive) setState(await r.json());
      } catch { /* offline */ }
    };
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const post = async (path: string, body: object) => {
    setBusy(true);
    try {
      await fetch(`${BACKEND}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const r = await fetch(`${BACKEND}/api/control/state`, { cache: 'no-store' });
      if (r.ok) setState(await r.json());
    } finally {
      setBusy(false);
    }
  };

  return (
    <WidgetShell title="Controls" position={position} width={220} height={220}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', fontSize: '0.75rem' }}>
        <Toggle
          label="XJarvis"
          icon="●"
          on={state?.jarvis.on ?? false}
          onClick={() => post('/api/control/jarvis', {})}
          disabled={busy}
        />
        <Toggle
          label="Kamera"
          icon="📷"
          on={state?.camera.on ?? false}
          onClick={() => post('/api/control/camera', {})}
          disabled={busy || !state?.camera.available}
        />
        <Toggle
          label="Mikrofon"
          icon="🎤"
          on={state?.mic.on ?? false}
          onClick={() => post('/api/control/mic', {})}
          disabled={busy || !state?.mic.available}
        />
        <VolumeRow
          level={state?.volume ?? null}
          onSet={(level) => post('/api/control/volume', { level })}
          onDelta={(delta) => post('/api/control/volume', { delta })}
          disabled={busy}
        />
      </div>
    </WidgetShell>
  );
}

function Toggle({ label, icon, on, onClick, disabled }: {
  label: string; icon: string; on: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.45rem 0.7rem',
        borderRadius: 8,
        background: on ? 'rgba(var(--hud-rgb), 0.12)' : 'rgba(255, 255, 255, 0.04)',
        border: `1px solid ${on ? 'rgba(var(--hud-rgb), 0.45)' : 'rgba(255, 255, 255, 0.1)'}`,
        color: on ? 'var(--hud-cyan, #00d4ff)' : '#a1a1aa',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: '0.75rem',
        transition: 'all 120ms',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '0.85rem' }}>{icon}</span>
        <span>{label}</span>
      </span>
      <span
        style={{
          width: 22, height: 12, borderRadius: 6,
          background: on ? 'var(--hud-cyan, #00d4ff)' : '#3f3f46',
          position: 'relative',
          transition: 'background 120ms',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 1, left: on ? 11 : 1,
            width: 10, height: 10, borderRadius: 5,
            background: '#fff',
            transition: 'left 120ms',
          }}
        />
      </span>
    </button>
  );
}

function VolumeRow({ level, onSet, onDelta, disabled }: {
  level: number | null;
  onSet: (level: number) => void;
  onDelta: (delta: number) => void;
  disabled?: boolean;
}) {
  const display = level == null ? '—' : `${level}`;
  return (
    <div style={{
      padding: '0.45rem 0.7rem',
      borderRadius: 8,
      background: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#a1a1aa' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🔊</span>
          <span>Ses</span>
        </span>
        <span style={{ color: 'var(--hud-cyan, #00d4ff)', fontFamily: 'monospace' }}>{display}</span>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <SmallBtn onClick={() => onSet(0)} disabled={disabled} title="Sustur">🔇</SmallBtn>
        <SmallBtn onClick={() => onDelta(-10)} disabled={disabled} title="Azalt">−10</SmallBtn>
        <SmallBtn onClick={() => onDelta(+10)} disabled={disabled} title="Artır" emphasis>+10</SmallBtn>
        <SmallBtn onClick={() => onSet(100)} disabled={disabled} title="Maksimum">MAX</SmallBtn>
      </div>
      <input
        type="range" min={0} max={100}
        value={level ?? 0}
        onChange={(e) => onSet(parseInt(e.target.value, 10))}
        disabled={disabled}
        style={{ width: '100%', accentColor: 'var(--hud-cyan, #00d4ff)' }}
      />
    </div>
  );
}

function SmallBtn({ onClick, disabled, children, title, emphasis }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; title?: string; emphasis?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        flex: 1,
        background: emphasis ? 'rgba(var(--hud-rgb), 0.22)' : 'rgba(var(--hud-rgb), 0.08)',
        border: `1px solid ${emphasis ? 'rgba(var(--hud-rgb), 0.6)' : 'rgba(var(--hud-rgb), 0.25)'}`,
        color: 'var(--hud-cyan, #00d4ff)',
        borderRadius: 4,
        padding: '0.25rem 0.4rem',
        fontSize: '0.65rem',
        fontWeight: emphasis ? 700 : 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
