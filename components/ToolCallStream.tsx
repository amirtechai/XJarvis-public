'use client';

import { useEffect, useState } from 'react';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES, type JarvisEvent } from '@/lib/events';

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  startedAt: number;
  endedAt?: number;
  result?: string;
}

const SUBSCRIBE = [
  EVENT_TYPES.TOOL_CALL_START,
  EVENT_TYPES.TOOL_CALL_END,
  EVENT_TYPES.RESPONSE_END,
  EVENT_TYPES.QUERY_RECEIVED,
];

const MAX_VISIBLE = 8;
const AUTO_DISMISS_MS = 8_000;

function getName(e: JarvisEvent): string | undefined {
  const n = (e.payload as { name?: unknown })?.name;
  return typeof n === 'string' ? n : undefined;
}
function getArgs(e: JarvisEvent): Record<string, unknown> {
  const a = (e.payload as { args?: unknown })?.args;
  return a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
}

export function ToolCallStream() {
  const { lastEvent } = useJarvisEvents(SUBSCRIBE);
  const [calls, setCalls] = useState<ToolCall[]>([]);

  useEffect(() => {
    if (!lastEvent) return;
    const ts = lastEvent.timestamp;

    if (lastEvent.event === EVENT_TYPES.QUERY_RECEIVED) {
      // New turn — clear stale calls
      setCalls([]);
      return;
    }
    if (lastEvent.event === EVENT_TYPES.TOOL_CALL_START) {
      const name = getName(lastEvent);
      if (!name) return;
      const id = `${ts}-${name}`;
      setCalls((prev) => {
        const next: ToolCall[] = [
          ...prev,
          { id, name, args: getArgs(lastEvent), startedAt: ts },
        ];
        return next.slice(-MAX_VISIBLE);
      });
      return;
    }
    if (lastEvent.event === EVENT_TYPES.TOOL_CALL_END) {
      const name = getName(lastEvent);
      if (!name) return;
      setCalls((prev) =>
        prev.map((c) =>
          c.name === name && !c.endedAt
            ? { ...c, endedAt: ts }
            : c,
        ),
      );
      return;
    }
    if (lastEvent.event === EVENT_TYPES.RESPONSE_END) {
      // Auto-dismiss the current batch after a delay
      const t = setTimeout(() => setCalls([]), AUTO_DISMISS_MS);
      return () => clearTimeout(t);
    }
  }, [lastEvent]);

  if (calls.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '6px 12px',
        margin: '0 12px 6px 12px',
        borderRadius: 8,
        background: 'rgba(var(--hud-rgb), 0.04)',
        border: '1px solid rgba(var(--hud-rgb), 0.15)',
        fontSize: 12,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {calls.map((c) => (
        <ToolRow key={c.id} call={c} />
      ))}
    </div>
  );
}

function ToolRow({ call }: { call: ToolCall }) {
  const done = call.endedAt != null;
  const dur = call.endedAt ? call.endedAt - call.startedAt : null;

  // Render args compactly (max 60 chars total)
  const argSummary = summarizeArgs(call.args);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: done ? '#67e8f9' : '#fbbf24' }}>
      <span style={{ minWidth: 14, textAlign: 'center' }}>
        {done ? '✓' : <Spinner />}
      </span>
      <span style={{ color: '#34d399' }}>{call.name}</span>
      {argSummary && (
        <span style={{ color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {argSummary}
        </span>
      )}
      {dur != null && (
        <span style={{ color: '#52525b', fontSize: 10 }}>{dur} ms</span>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8, height: 8,
        borderRadius: '50%',
        background: '#fbbf24',
        animation: 'hud-pulse 1s ease-in-out infinite',
      }}
    />
  );
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args || {});
  if (entries.length === 0) return '';
  const parts = entries.map(([k, v]) => {
    let s: string;
    if (typeof v === 'string') s = v.length > 40 ? `${v.slice(0, 40)}…` : v;
    else s = JSON.stringify(v);
    return `${k}=${s}`;
  });
  const joined = parts.join(' ');
  return joined.length > 80 ? `${joined.slice(0, 80)}…` : joined;
}
