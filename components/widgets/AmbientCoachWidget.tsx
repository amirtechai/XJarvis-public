'use client';

import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

interface Tip {
  id: string;
  text: string;
  type: 'stretch' | 'water' | 'eyes' | 'breath' | 'standup' | 'health';
  triggered_at: number;
}

const TIPS: Array<Omit<Tip, 'triggered_at'>> = [
  { id: 'stretch', type: 'stretch', text: 'Ayağa kalk, 30 sn omuzlarını çevir.' },
  { id: 'water',   type: 'water',   text: 'Su iç. 250 ml sana iyi gelir.' },
  { id: 'eyes',    type: 'eyes',    text: '20-20-20: 20 sn 20 ft uzağa bak.' },
  { id: 'breath',  type: 'breath',  text: 'Box breath: 4-4-4-4 saniye, 3 tur.' },
  { id: 'standup', type: 'standup', text: 'Bir tur yürü — 2 dakika.' },
  { id: 'health',  type: 'health',  text: 'Postür kontrolü — sırtın dik mi?' },
];

const ICONS: Record<Tip['type'], string> = {
  stretch: '🤸', water: '💧', eyes: '👁', breath: '🫁', standup: '🚶', health: '♥',
};

const LS_LAST = 'xjarvis:coach:last';
const LS_INTERVAL = 'xjarvis:coach:interval';

export function AmbientCoachWidget({ position }: { position: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [current, setCurrent] = useState<Tip | null>(null);
  const [intervalMin, setIntervalMin] = useState(45);

  useEffect(() => {
    const saved = parseInt(localStorage.getItem(LS_INTERVAL) || '45', 10);
    if (saved >= 10 && saved <= 240) setIntervalMin(saved);
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const last = parseInt(localStorage.getItem(LS_LAST) || '0', 10);
      const elapsed = now - last;
      if (elapsed > intervalMin * 60_000) {
        const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
        setCurrent({ ...tip, triggered_at: now });
        localStorage.setItem(LS_LAST, String(now));
      }
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [intervalMin]);

  const dismiss = () => setCurrent(null);
  const snooze = () => {
    localStorage.setItem(LS_LAST, String(Date.now() - (intervalMin - 15) * 60_000));
    setCurrent(null);
  };

  return (
    <WidgetShell title="Coach" position={position}>
      {current ? (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '1.6rem' }}>{ICONS[current.type]}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
            {current.text}
          </div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
            <button
              onClick={dismiss}
              style={miniBtn('rgba(52,211,153,0.18)', 'rgba(52,211,153,0.5)', '#34d399')}
            >✓ Yaptım</button>
            <button
              onClick={snooze}
              style={miniBtn('rgba(0,212,255,0.12)', 'rgba(0,212,255,0.4)', 'var(--hud-cyan)')}
            >+15dk</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: '1.4rem', opacity: 0.4 }}>♨</div>
          <div style={{ fontSize: '0.55rem', opacity: 0.6, letterSpacing: '0.1em' }}>
            Sıradaki ipucu {intervalMin}dk sonra
          </div>
          <select
            value={intervalMin}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setIntervalMin(v);
              localStorage.setItem(LS_INTERVAL, String(v));
            }}
            style={{
              background: 'transparent',
              border: '1px solid rgba(var(--hud-rgb),0.2)',
              color: 'var(--text-secondary)',
              fontSize: 9, padding: '2px 4px', borderRadius: 3,
              fontFamily: 'inherit',
            }}
          >
            <option value={15}>15dk</option>
            <option value={30}>30dk</option>
            <option value={45}>45dk</option>
            <option value={60}>1sa</option>
            <option value={90}>1.5sa</option>
            <option value={120}>2sa</option>
          </select>
        </div>
      )}
    </WidgetShell>
  );
}

function miniBtn(bg: string, border: string, color: string): React.CSSProperties {
  return {
    padding: '3px 8px', fontSize: 9, letterSpacing: '0.1em',
    background: bg, border: `1px solid ${border}`, color,
    borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
    textTransform: 'uppercase', fontWeight: 600,
  };
}
