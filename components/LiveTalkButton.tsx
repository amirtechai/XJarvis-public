'use client';

/**
 * CANLI KONUŞMA düğmesi — Gemini Live gerçek-zamanlı sesli sohbeti
 * voice servisi (:8766/realtime/*) üzerinden açıp kapatır.
 * Aktifken nabız efekti + durum etiketi gösterir.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const VOICE = 'http://localhost:8766';

type RtState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

export function LiveTalkButton() {
  const [state, setState] = useState<RtState>('idle');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const readStatus = useCallback(async () => {
    try {
      const r = await fetch(`${VOICE}/realtime/status`);
      const j = await r.json();
      const s: string = j.status || 'idle';
      if (!j.active) setState('idle');
      else if (s.startsWith('error')) setState('error');
      else if (s === 'listening' || s === 'thinking' || s === 'speaking') setState(s);
      else setState('connecting');
    } catch {
      setState('idle');
    }
  }, []);

  useEffect(() => {
    // Aktifken durumu izle; pasifken poll etme (gereksiz istek yok).
    if (state === 'idle' || state === 'error') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (!pollRef.current) pollRef.current = setInterval(readStatus, 3000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [state, readStatus]);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (state === 'idle' || state === 'error') {
        setState('connecting');
        const r = await fetch(`${VOICE}/realtime/start`, { method: 'POST' });
        const j = await r.json();
        if (!j.ok) setState('error');
        else setTimeout(readStatus, 1200);
      } else {
        await fetch(`${VOICE}/realtime/stop`, { method: 'POST' });
        setState('idle');
      }
    } catch {
      setState('error');
    } finally {
      setBusy(false);
    }
  }, [state, busy, readStatus]);

  const active = state !== 'idle' && state !== 'error';
  const label =
    state === 'listening' ? 'CANLI · DİNLİYOR' :
    state === 'thinking' ? 'CANLI · DÜŞÜNÜYOR' :
    state === 'speaking' ? 'CANLI · KONUŞUYOR' :
    state === 'connecting' ? 'BAĞLANIYOR…' :
    state === 'error' ? 'HATA · TEKRAR DENE' : 'CANLI KONUŞMA';
  const color =
    state === 'error' ? '#ff006e' :
    state === 'thinking' ? '#ffb700' :
    active ? '#00f5a0' : '#00d9ff';

  return (
    <button
      onClick={toggle}
      title="Gemini Live gerçek-zamanlı sesli sohbet (aç/kapat)"
      style={{
        fontFamily: 'var(--font-orbitron, monospace)',
        fontSize: 11,
        letterSpacing: '0.25em',
        padding: '8px 18px',
        borderRadius: 999,
        cursor: 'pointer',
        color,
        border: `1px solid ${color}55`,
        background: active ? `${color}14` : 'rgba(20, 25, 50, 0.4)',
        backdropFilter: 'blur(15px)',
        WebkitBackdropFilter: 'blur(15px)',
        boxShadow: active ? `0 0 14px ${color}33` : 'none',
        animation: state === 'listening' ? 'hud-pulse 2s ease-in-out infinite' : 'none',
        transition: 'all 200ms ease',
      }}
    >
      ● {label}
    </button>
  );
}
