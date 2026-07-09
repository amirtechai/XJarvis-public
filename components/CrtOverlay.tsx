'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'xjarvis:crt-overlay';

export function CrtOverlay() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved === '1') setEnabled(true);
  }, []);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    }
  }, [enabled]);

  // Toggle via Ctrl+Alt+C
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'c') {
        setEnabled((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!enabled) return null;

  return (
    <>
      {/* horizontal scanlines */}
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          pointerEvents: 'none',
          background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 2px, transparent 3px)',
          mixBlendMode: 'multiply',
        }}
      />
      {/* slow rolling sweep */}
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          pointerEvents: 'none',
          background: 'linear-gradient(180deg, transparent 0%, rgba(var(--hud-rgb),0.04) 45%, rgba(var(--hud-rgb),0.07) 50%, rgba(var(--hud-rgb),0.04) 55%, transparent 100%)',
          backgroundSize: '100% 240px',
          animation: 'crtSweep 6s linear infinite',
          mixBlendMode: 'screen',
        }}
      />
      {/* subtle vignette */}
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          pointerEvents: 'none',
          background: 'radial-gradient(circle at 50% 50%, transparent 60%, rgba(0,0,0,0.45) 100%)',
        }}
      />
      <style jsx global>{`
        @keyframes crtSweep {
          0% { background-position: 0 -240px; }
          100% { background-position: 0 100vh; }
        }
      `}</style>
    </>
  );
}
