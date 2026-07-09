'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface State {
  last_event_at: number;
  motion: number;
  detections: Array<{ label: string; confidence: number; bbox?: number[] }>;
  announce: boolean;
}

export function VisionDetectSection() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/vision-detect/state`);
      const j = await r.json();
      if (j.ok) setState(j);
    } catch { /* noop */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const toggleAnnounce = async () => {
    if (!state) return;
    setBusy(true);
    try {
      await fetch(`${BACKEND}/api/vision-detect/${state.announce ? 'announce-off' : 'announce-on'}`, { method: 'POST' });
      await load();
    } finally { setBusy(false); }
  };

  const describe = async () => {
    setBusy(true); setDescription(null);
    try {
      const r = await fetch(`${BACKEND}/api/vision-detect/describe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      setDescription(j.text || j.error || 'no response');
    } finally { setBusy(false); }
  };

  if (!state) return <div style={{ opacity: 0.5, fontSize: 11 }}>Yükleniyor…</div>;

  const lastSeenSec = state.last_event_at ? Math.round((Date.now() - state.last_event_at) / 1000) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '0.75rem', opacity: 0.7, lineHeight: 1.5 }}>
        Kamera ile cisim/hareket tespiti — vision.service&apos;in YOLO modeli arka planda
        çalışır. <strong>Announce</strong> açıkken yeni bir cisim görüldüğünde XJarvis
        sesli olarak söyler (her cisim için 30sn debounce).
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={toggleAnnounce} disabled={busy}
          style={{
            padding: '6px 14px', fontSize: 11, letterSpacing: '0.1em',
            background: state.announce ? 'rgba(52,211,153,0.18)' : 'transparent',
            border: `1px solid ${state.announce ? '#34d399' : 'rgba(255,255,255,0.18)'}`,
            color: state.announce ? '#34d399' : 'var(--text-secondary)',
            borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
            textTransform: 'uppercase', fontWeight: 600,
          }}
        >{state.announce ? '✓ ANNOUNCE ON' : '○ ANNOUNCE OFF'}</button>
        <button
          onClick={describe} disabled={busy}
          style={{
            padding: '6px 14px', fontSize: 11, letterSpacing: '0.1em',
            background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.4)',
            color: 'var(--hud-cyan)', borderRadius: 4, cursor: 'pointer',
            fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 600,
          }}
        >👁 DESCRIBE NOW</button>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
          motion: {state.motion.toFixed(2)} · {state.detections.length} detection
          {lastSeenSec != null && ` · ${lastSeenSec}s ago`}
        </span>
      </div>

      {state.detections.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {state.detections.map((d, i) => (
            <span key={i} style={{
              padding: '4px 10px', fontSize: 10, borderRadius: 12,
              background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)',
              color: 'var(--hud-cyan)', fontFamily: 'monospace',
            }}>
              {d.label} · {(d.confidence * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      )}

      {description && (
        <div style={{
          padding: 12, fontSize: 12, lineHeight: 1.6,
          background: 'rgba(0,12,24,0.5)', border: '1px solid rgba(0,212,255,0.2)',
          borderRadius: 4, color: 'var(--text-primary)',
        }}>{description}</div>
      )}
    </div>
  );
}
