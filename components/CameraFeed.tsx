'use client';
import { useEffect, useState } from 'react';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';

const STREAM_URL = process.env.NEXT_PUBLIC_VISION_STREAM_URL || 'http://localhost:8765/stream';

export function CameraFeed() {
  const [active, setActive] = useState(false);
  const [hideTimer, setHideTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const { lastEvent } = useJarvisEvents([
    EVENT_TYPES.VISION_TRIGGERED,
    EVENT_TYPES.VISION_SCANNING,
    EVENT_TYPES.VISION_RESULT,
  ]);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.event === EVENT_TYPES.VISION_TRIGGERED || lastEvent.event === EVENT_TYPES.VISION_SCANNING) {
      setActive(true);
      if (hideTimer) clearTimeout(hideTimer);
    } else if (lastEvent.event === EVENT_TYPES.VISION_RESULT) {
      // Keep feed visible briefly after analysis completes
      const t = setTimeout(() => setActive(false), 6000);
      setHideTimer(t);
    }
  }, [lastEvent, hideTimer]);

  if (!active) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1, pointerEvents: 'none',
        backgroundImage: `url(${STREAM_URL})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'brightness(0.55) saturate(0.4) hue-rotate(180deg)',
      }}
    >
      {/* Scanline */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(var(--hud-rgb),0.08) 1px, transparent 1px)',
          backgroundSize: '100% 4px',
          mixBlendMode: 'screen',
        }}
      />
      {/* Moving sweep */}
      <div
        aria-hidden
        style={{
          position: 'absolute', left: 0, right: 0, height: '12vh',
          background: 'linear-gradient(rgba(var(--hud-rgb),0) 0%, rgba(var(--hud-rgb),0.15) 50%, rgba(var(--hud-rgb),0) 100%)',
          animation: 'vision-sweep 3s linear infinite',
        }}
      />
      {/* Corner brackets */}
      {[
        { top: 12, left: 12, br: '1px 0 0 1px' },
        { top: 12, right: 12, br: '0 1px 0 1px' },
        { bottom: 12, left: 12, br: '1px 0 0 0' },
        { bottom: 12, right: 12, br: '0 0 1px 1px' },
      ].map((c, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            position: 'absolute',
            ...c,
            width: 36, height: 36,
            borderColor: 'var(--hud-cyan)',
            borderStyle: 'solid',
            borderWidth: c.br,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes vision-sweep { 0% { top: -12vh; } 100% { top: 100vh; } }
      `}</style>
    </div>
  );
}
