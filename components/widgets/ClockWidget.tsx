'use client';
import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

const fmtTime = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  timeZone: 'Europe/Istanbul', hour12: false,
});
const fmtDate = new Intl.DateTimeFormat('tr-TR', {
  weekday: 'long', day: 'numeric', month: 'long',
  timeZone: 'Europe/Istanbul',
});

const LS_MODE = 'xjarvis:clock:mode';
type Mode = 'digital' | 'analog';

export function ClockWidget({ position }: { position: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [now, setNow] = useState<Date | null>(null);
  const [mode, setMode] = useState<Mode>('digital');

  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setInterval(tick, 1000);
    tick();
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(LS_MODE) as Mode | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === 'digital' || saved === 'analog') setMode(saved);
  }, []);

  const setModeAndSave = (m: Mode) => {
    setMode(m);
    try { window.localStorage.setItem(LS_MODE, m); } catch { /* noop */ }
  };

  if (!now) {
    return <WidgetShell title="Time" position={position}><span>—</span></WidgetShell>;
  }

  return (
    <WidgetShell title="Time" position={position}>
      <ModeToggle mode={mode} onChange={setModeAndSave} />
      {mode === 'analog' ? <AnalogFace now={now} /> : <DigitalFace now={now} />}
    </WidgetShell>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div style={{
      position: 'absolute', top: 6, right: 6, zIndex: 4,
      display: 'flex', gap: 2,
      background: 'rgba(0,0,0,0.4)', borderRadius: 3, padding: 2,
      border: '1px solid rgba(var(--hud-rgb),0.18)',
    }}>
      {(['digital', 'analog'] as Mode[]).map((m) => (
        <button
          key={m}
          onClick={(e) => { e.stopPropagation(); onChange(m); }}
          title={m}
          style={{
            padding: '2px 6px', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase',
            background: mode === m ? 'rgba(var(--hud-rgb),0.25)' : 'transparent',
            border: 'none', borderRadius: 2,
            color: mode === m ? 'var(--hud-cyan)' : 'rgba(255,255,255,0.4)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >{m === 'digital' ? 'D' : 'A'}</button>
      ))}
    </div>
  );
}

function DigitalFace({ now }: { now: Date }) {
  const seconds = now.getSeconds();
  const arc = (seconds / 60) * 2 * Math.PI;
  const r = 70, cx = 80, cy = 80;
  const x = cx + r * Math.sin(arc);
  const y = cy - r * Math.cos(arc);
  const large = arc > Math.PI ? 1 : 0;
  const path = `M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;

  return (
    <>
      <svg viewBox="0 0 160 160" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(var(--hud-rgb),0.12)" strokeWidth="1" />
        <path d={path} fill="none" stroke="var(--hud-cyan)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{fmtTime.format(now)}</div>
      <div style={{ fontSize: '0.55rem', opacity: 0.7, marginTop: '0.25rem' }}>{fmtDate.format(now)}</div>
    </>
  );
}

function AnalogFace({ now }: { now: Date }) {
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();

  const hourAngle = ((h + m / 60) / 12) * 2 * Math.PI;
  const minAngle  = ((m + s / 60) / 60) * 2 * Math.PI;
  const secAngle  = (s / 60) * 2 * Math.PI;

  const cx = 80, cy = 80;
  const polar = (angle: number, r: number) => ({
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  });
  const hp = polar(hourAngle, 36);
  const mp = polar(minAngle, 56);
  const sp = polar(secAngle, 64);

  const ticks = Array.from({ length: 12 }).map((_, i) => {
    const a = (i / 12) * 2 * Math.PI;
    const inner = polar(a, 60);
    const outer = polar(a, 70);
    return (
      <line
        key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
        stroke="rgba(var(--hud-rgb),0.55)" strokeWidth={i % 3 === 0 ? 2 : 1}
      />
    );
  });

  return (
    <>
      <svg viewBox="0 0 160 160" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <circle cx={cx} cy={cy} r="72" fill="rgba(0,0,0,0.25)" stroke="rgba(var(--hud-rgb),0.32)" strokeWidth="1.2" />
        {ticks}
        <line x1={cx} y1={cy} x2={hp.x} y2={hp.y} stroke="var(--hud-cyan)" strokeWidth="3" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={mp.x} y2={mp.y} stroke="var(--hud-cyan)" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        <line x1={cx} y1={cy} x2={sp.x} y2={sp.y} stroke="#ff5577" strokeWidth="1" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3" fill="var(--hud-cyan)" />
      </svg>
      <div style={{ position: 'absolute', bottom: 6, fontSize: '0.5rem', opacity: 0.6, letterSpacing: '0.1em' }}>
        {fmtDate.format(now)}
      </div>
    </>
  );
}
