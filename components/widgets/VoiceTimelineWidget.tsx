'use client';

import { useMemo } from 'react';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES, type JarvisEvent } from '@/lib/events';
import { WidgetShell } from './WidgetShell';

const SUBSCRIBE = [
  EVENT_TYPES.STT_PARTIAL,
  EVENT_TYPES.STT_FINAL,
  EVENT_TYPES.WAKE_WORD_DETECTED,
  EVENT_TYPES.LISTENING_END,
  EVENT_TYPES.TOOL_CALL_START,
  EVENT_TYPES.TOOL_CALL_END,
  EVENT_TYPES.RESPONSE_END,
];

function getText(e: JarvisEvent): string | undefined {
  const t = (e.payload as { text?: unknown })?.text;
  return typeof t === 'string' ? t : undefined;
}
function getToolName(e: JarvisEvent): string | undefined {
  const n = (e.payload as { name?: unknown })?.name;
  return typeof n === 'string' ? n : undefined;
}

interface Props {
  position?: { top?: string; bottom?: string; left?: string; right?: string };
}

export function VoiceTimelineWidget({ position }: Props = {}) {
  const { eventHistory } = useJarvisEvents(SUBSCRIBE);

  const recent = useMemo(() => eventHistory.slice(-10).reverse(), [eventHistory]);

  return (
    <WidgetShell title="Voice & Tools" position={position} width={260} height={200}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.65rem', fontFamily: 'monospace', textAlign: 'left', width: '100%' }}>
        {recent.length === 0 && (
          <div className="text-zinc-500">listening...</div>
        )}
        {recent.map((e, i) => {
          const time = new Date(e.timestamp).toLocaleTimeString('tr-TR');
          const t = <span style={{ color: '#52525b' }}>{time}</span>;
          if (e.event === EVENT_TYPES.WAKE_WORD_DETECTED) {
            return <div key={i} style={{ color: '#fbbf24' }}>{t} ● wake</div>;
          }
          if (e.event === EVENT_TYPES.STT_PARTIAL || e.event === EVENT_TYPES.STT_FINAL) {
            const text = getText(e);
            if (text === undefined) return null;
            const final = e.event === EVENT_TYPES.STT_FINAL;
            return (
              <div key={i} style={{ color: final ? '#67e8f9' : '#a1a1aa' }}>
                {t} {final ? '✓' : '…'} {text}
              </div>
            );
          }
          if (e.event === EVENT_TYPES.TOOL_CALL_START) {
            const name = getToolName(e);
            if (!name) return null;
            return <div key={i} style={{ color: '#34d399' }}>{t} → {name}</div>;
          }
          if (e.event === EVENT_TYPES.TOOL_CALL_END) {
            const name = getToolName(e);
            if (!name) return null;
            return <div key={i} style={{ color: '#6ee7b7' }}>{t} ← {name}</div>;
          }
          if (e.event === EVENT_TYPES.RESPONSE_END) {
            return <div key={i} style={{ color: '#71717a' }}>{t} ─ done</div>;
          }
          if (e.event === EVENT_TYPES.LISTENING_END) {
            return <div key={i} style={{ color: '#71717a' }}>{t} ─ listening end</div>;
          }
          return null;
        })}
      </div>
    </WidgetShell>
  );
}
