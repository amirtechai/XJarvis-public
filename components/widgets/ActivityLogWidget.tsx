'use client';
import { useEffect, useRef, useState } from 'react';
import { WidgetShell } from './WidgetShell';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';

interface LogEntry {
  id: string;
  ts: number;
  kind: 'voice' | 'vision' | 'system';
  text: string;
}

const MAX = 5;

export function ActivityLogWidget({ position }: { position: { top?: string; right?: string } }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const responseBuffer = useRef('');

  const { lastEvent } = useJarvisEvents([
    EVENT_TYPES.QUERY_RECEIVED,
    EVENT_TYPES.RESPONSE_CHUNK,
    EVENT_TYPES.RESPONSE_END,
    EVENT_TYPES.VISION_RESULT,
  ]);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.event === EVENT_TYPES.QUERY_RECEIVED) {
      const text = (lastEvent.payload as { text?: string }).text ?? '';
      const kind: LogEntry['kind'] = lastEvent.source === 'voice' ? 'voice' : 'system';
      setEntries((prev) => [
        { id: crypto.randomUUID(), ts: lastEvent.timestamp, kind, text: text.slice(0, 50) },
        ...prev,
      ].slice(0, MAX));
    } else if (lastEvent.event === EVENT_TYPES.RESPONSE_CHUNK) {
      responseBuffer.current += (lastEvent.payload as { text?: string }).text ?? '';
    } else if (lastEvent.event === EVENT_TYPES.RESPONSE_END) {
      const snippet = responseBuffer.current.trim().slice(0, 40);
      responseBuffer.current = '';
      if (snippet) {
        setEntries((prev) => prev.map((e, i) => i === 0 ? { ...e, text: `${e.text} → ${snippet}` } : e));
      }
    } else if (lastEvent.event === EVENT_TYPES.VISION_RESULT) {
      const desc = (lastEvent.payload as { scene_description?: string }).scene_description ?? 'vision scan';
      setEntries((prev) => [
        { id: crypto.randomUUID(), ts: lastEvent.timestamp, kind: 'vision' as const, text: desc.slice(0, 60) },
        ...prev,
      ].slice(0, MAX));
    }
  }, [lastEvent]);

  const color = (k: LogEntry['kind']) =>
    k === 'voice' ? 'var(--hud-cyan)' : k === 'vision' ? 'var(--hud-amber)' : 'var(--text-muted)';

  return (
    <WidgetShell title="Activity" position={position} width={220} height={200}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', width: '100%', alignItems: 'flex-start', textAlign: 'left' }}>
        {entries.length === 0 && <span style={{ opacity: 0.5, fontSize: '0.55rem' }}>no activity</span>}
        {entries.map((e) => (
          <div key={e.id} style={{ fontSize: '0.5rem', color: color(e.kind), opacity: 0.9, lineHeight: 1.3 }}>
            <div style={{ opacity: 0.5 }}>
              {new Date(e.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div>{e.text}</div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
