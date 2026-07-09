'use client';
import { useEffect, useRef, useState } from 'react';
import { WidgetShell } from './WidgetShell';

type Mode = 'focus' | 'break';
const FOCUS_S = 25 * 60;
const BREAK_S = 5 * 60;

export function PomodoroWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [mode, setMode] = useState<Mode>('focus');
  const [remaining, setRemaining] = useState(FOCUS_S);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) return;
    tickRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          const nextMode: Mode = mode === 'focus' ? 'break' : 'focus';
          setMode(nextMode);
          if (mode === 'focus') setCount((c) => c + 1);
          try { new Audio('/notify.mp3').play().catch(() => {}); } catch { /* noop */ }
          return nextMode === 'focus' ? FOCUS_S : BREAK_S;
        }
        return r - 1;
      });
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [running, mode]);

  const reset = () => {
    setRunning(false);
    setMode('focus');
    setRemaining(FOCUS_S);
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const total = mode === 'focus' ? FOCUS_S : BREAK_S;
  const pct = ((total - remaining) / total) * 100;
  const color = mode === 'focus' ? 'var(--hud-cyan, #00d4ff)' : '#34d399';

  return (
    <WidgetShell title="Focus" position={position}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}>
        <div style={{ fontSize: '0.5rem', letterSpacing: '0.18em', opacity: 0.7, color }}>
          {mode === 'focus' ? 'POMODORO' : 'BREAK'}
        </div>
        <div style={{ fontSize: '1.25rem', fontFamily: 'monospace', color }}>{mm}:{ss}</div>
        <div style={{ width: '90%', height: 3, background: '#27272a', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 1s linear' }} />
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <Btn onClick={() => setRunning((r) => !r)}>{running ? 'Dur' : 'Başla'}</Btn>
          <Btn onClick={reset}>Sıfırla</Btn>
        </div>
        <div style={{ fontSize: '0.5rem', opacity: 0.6 }}>tamamlanan: {count}</div>
      </div>
    </WidgetShell>
  );
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'rgba(var(--hud-rgb), 0.1)',
        border: '1px solid rgba(var(--hud-rgb), 0.35)',
        color: 'var(--hud-cyan, #00d4ff)',
        borderRadius: 3,
        padding: '2px 8px',
        fontSize: '0.55rem',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}
