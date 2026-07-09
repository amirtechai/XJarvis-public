'use client';

import { useEffect, useRef, useState } from 'react';

const IDLE_MS = 180_000; // 3 dakika

export function StandbyMode() {
  const [active, setActive] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const lastActivityRef = useRef(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const bump = () => { lastActivityRef.current = Date.now(); if (active) setActive(false); };
    const events = ['mousemove', 'keydown', 'click', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    const tick = setInterval(() => {
      setNow(new Date());
      if (Date.now() - lastActivityRef.current > IDLE_MS) {
        setActive((prev) => prev || true);
      }
    }, 1000);
    intervalRef.current = tick;

    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active]);

  if (!active) return null;

  const day = now.toLocaleDateString('tr-TR', { weekday: 'long', day: '2-digit', month: 'long' });
  const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      onClick={() => setActive(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'radial-gradient(circle at 50% 45%, #001628 0%, #000a16 70%, #000 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
        cursor: 'pointer',
        animation: 'standbyFade 600ms ease',
      }}
    >
      <ParticleSphere />
      <div style={{
        marginTop: '2.5rem',
        fontFamily: 'var(--font-orbitron, monospace)',
        fontSize: '5rem', letterSpacing: '0.15em',
        color: '#9ed8ff', fontWeight: 200,
        textShadow: '0 0 24px rgba(var(--hud-rgb),0.5)',
      }}>{time}</div>
      <div style={{
        marginTop: '0.5rem',
        fontSize: '0.85rem', letterSpacing: '0.4em',
        color: 'rgba(180,220,255,0.55)',
        textTransform: 'uppercase',
      }}>{day}</div>
      <div style={{
        position: 'absolute', bottom: '2.5rem',
        fontSize: '0.6rem', letterSpacing: '0.3em',
        color: 'rgba(150,210,255,0.35)',
      }}>tap or speak to wake</div>
      <style jsx>{`
        @keyframes standbyFade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>
  );
}

function ParticleSphere() {
  // Static particle ring — 80 dots arranged in a sphere illusion
  const dots: { cx: number; cy: number; r: number; o: number }[] = [];
  for (let i = 0; i < 90; i++) {
    const phi = Math.acos(-1 + (2 * i) / 90);
    const theta = Math.sqrt(90 * Math.PI) * phi;
    const x = 70 * Math.cos(theta) * Math.sin(phi);
    const y = 70 * Math.sin(theta) * Math.sin(phi);
    const z = 70 * Math.cos(phi);
    const proj = (z + 100) / 170;
    dots.push({
      cx: 100 + x,
      cy: 100 + y * 0.85,
      r: 0.6 + proj * 1.6,
      o: 0.2 + proj * 0.7,
    });
  }
  return (
    <div style={{ position: 'relative', width: 280, height: 280 }}>
      <svg viewBox="0 0 200 200" width={280} height={280} style={{ filter: 'drop-shadow(0 0 22px rgba(var(--hud-rgb),0.45))' }}>
        <defs>
          <radialGradient id="standby-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#a8eaff" stopOpacity="0.95" />
            <stop offset="60%" stopColor="#1f9fd8" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#0a2d4a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="40" fill="url(#standby-core)" className="standby-pulse" />
        {dots.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="#7ad9ff" opacity={d.o} />
        ))}
        <circle cx="100" cy="100" r="78" fill="none" stroke="#3aa4d9" strokeOpacity="0.35" strokeWidth="0.5" />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-orbitron, monospace)',
        fontSize: '1.05rem', letterSpacing: '0.25em',
        color: '#cfeeff', textShadow: '0 0 12px rgba(0,180,255,0.7)',
        pointerEvents: 'none',
      }}>JARVIS</div>
      <style jsx>{`
        :global(.standby-pulse) { animation: standbyPulse 4s ease-in-out infinite; transform-origin: center; }
        @keyframes standbyPulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
      `}</style>
    </div>
  );
}
