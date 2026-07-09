'use client';

import { useEffect, useState } from 'react';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES, type JarvisEvent } from '@/lib/events';

const SUBSCRIBE = [
  EVENT_TYPES.TURN_LATENCY,
  EVENT_TYPES.TOOL_CALL_START,
  EVENT_TYPES.TOOL_CALL_END,
];

function getName(e: JarvisEvent): string | undefined {
  const n = (e.payload as { name?: unknown })?.name;
  return typeof n === 'string' ? n : undefined;
}
function getMs(e: JarvisEvent): number | undefined {
  const v = (e.payload as { total_ms?: unknown })?.total_ms;
  return typeof v === 'number' ? v : undefined;
}

export function MobileStatusStrip() {
  const { lastEvent } = useJarvisEvents(SUBSCRIBE);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.event === EVENT_TYPES.TOOL_CALL_START) {
      setActiveTool(getName(lastEvent) ?? null);
    } else if (lastEvent.event === EVENT_TYPES.TOOL_CALL_END) {
      setActiveTool(null);
    } else if (lastEvent.event === EVENT_TYPES.TURN_LATENCY) {
      const ms = getMs(lastEvent);
      if (ms != null) setLastLatencyMs(ms);
    }
  }, [lastEvent]);

  if (!activeTool && lastLatencyMs == null) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        right: 12,
        display: 'flex',
        gap: 6,
        zIndex: 50,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 9,
        letterSpacing: 1.2,
      }}
    >
      {activeTool && (
        <span
          style={{
            padding: '3px 7px',
            borderRadius: 4,
            background: 'rgba(251,191,36,0.12)',
            border: '1px solid rgba(251,191,36,0.4)',
            color: '#fbbf24',
            animation: 'mobilePulse 1s ease-in-out infinite',
          }}
        >
          ● {activeTool}
        </span>
      )}
      {lastLatencyMs != null && (
        <span
          style={{
            padding: '3px 7px',
            borderRadius: 4,
            background: 'rgba(var(--hud-rgb),0.08)',
            border: '1px solid rgba(var(--hud-rgb),0.3)',
            color: '#00d4ff',
          }}
        >
          {lastLatencyMs}ms
        </span>
      )}
      <style>{`
        @keyframes mobilePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
