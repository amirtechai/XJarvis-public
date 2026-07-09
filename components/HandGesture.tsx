'use client';

import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'xjarvis:hand-gesture';
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js';
const CAMERA_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js';

declare global {
  interface Window {
    Hands?: any;
    Camera?: any;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous'; s.async = true;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function HandGesture() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('off');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const lastPinch = useRef(false);

  useEffect(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved === '1') setEnabled(true);
  }, []);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    }
  }, [enabled]);

  // Keyboard toggle: Ctrl+Alt+G
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'g') {
        setEnabled((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!enabled) { setStatus('off'); return; }
    let stopped = false;
    let camera: any = null;
    let hands: any = null;

    (async () => {
      setStatus('loading');
      try {
        await loadScript(CDN);
        await loadScript(CAMERA_CDN);
      } catch (e) {
        setStatus('cdn fail');
        return;
      }
      if (stopped) return;

      hands = new window.Hands({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.55,
      });

      hands.onResults((results: any) => {
        const lm = results.multiHandLandmarks?.[0];
        const cur = cursorRef.current;
        if (!lm || !cur) {
          if (cur) cur.style.opacity = '0';
          return;
        }
        const tip = lm[8];     // index finger tip
        const thumb = lm[4];   // thumb tip
        const x = (1 - tip.x) * window.innerWidth;  // mirror
        const y = tip.y * window.innerHeight;
        cur.style.transform = `translate(${x - 14}px, ${y - 14}px)`;
        cur.style.opacity = '0.95';

        const pinch = dist(tip, thumb) < 0.05;
        if (pinch && !lastPinch.current) {
          // Click at cursor location
          const el = document.elementFromPoint(x, y) as HTMLElement | null;
          if (el) el.click();
          cur.style.background = 'rgba(0,255,170,0.45)';
          setTimeout(() => { if (cur) cur.style.background = 'rgba(var(--hud-rgb),0.35)'; }, 180);
        }
        lastPinch.current = pinch;
      });

      const video = videoRef.current;
      if (!video) return;
      camera = new window.Camera(video, {
        onFrame: async () => { if (hands) await hands.send({ image: video }); },
        width: 640, height: 480,
      });
      try {
        await camera.start();
        setStatus('on');
      } catch {
        setStatus('mic/cam denied');
      }
    })();

    return () => {
      stopped = true;
      try { camera?.stop(); } catch { /* swallow */ }
      try { hands?.close(); } catch { /* swallow */ }
      setStatus('off');
    };
  }, [enabled]);

  return (
    <>
      <div style={{
        position: 'fixed', bottom: 8, right: 8, zIndex: 60,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button
          onClick={() => setEnabled((v) => !v)}
          title="Hand Gesture (Ctrl+Alt+G)"
          style={{
            background: enabled ? 'rgba(52,211,153,0.18)' : 'rgba(0,0,0,0.5)',
            color: enabled ? '#34d399' : 'rgba(var(--hud-rgb),0.7)',
            border: `1px solid ${enabled ? 'rgba(52,211,153,0.5)' : 'rgba(var(--hud-rgb),0.3)'}`,
            padding: '5px 10px', borderRadius: 6,
            fontSize: 11, fontFamily: 'monospace',
            cursor: 'pointer', letterSpacing: '0.1em',
          }}
        >
          ✋ {status}
        </button>
        <video ref={videoRef} style={{ display: 'none' }} muted playsInline />
      </div>
      <div ref={cursorRef} aria-hidden style={{
        position: 'fixed', top: 0, left: 0, width: 28, height: 28,
        borderRadius: '50%',
        background: 'rgba(var(--hud-rgb),0.35)',
        border: '2px solid rgba(var(--hud-rgb),0.9)',
        boxShadow: '0 0 18px rgba(var(--hud-rgb),0.7)',
        pointerEvents: 'none', zIndex: 99999,
        opacity: 0,
        transition: 'opacity 0.2s, background 0.2s',
        willChange: 'transform',
      }} />
    </>
  );
}
