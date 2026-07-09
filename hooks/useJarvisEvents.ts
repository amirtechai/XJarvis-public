'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { EventType, JarvisEvent } from '@/lib/events';

import { WS_URL } from '@/lib/backend';
const MAX_HISTORY = 50;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;

export interface UseJarvisEventsState {
  lastEvent: JarvisEvent | null;
  isConnected: boolean;
  eventHistory: JarvisEvent[];
  emit: (event: EventType, payload?: Record<string, unknown>, source?: string) => void;
}

export function useJarvisEvents(eventTypes: EventType[] | '*'): UseJarvisEventsState {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);
  const subscriptions = useRef<EventType[] | '*'>(eventTypes);
  const [lastEvent, setLastEvent] = useState<JarvisEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [eventHistory, setEventHistory] = useState<JarvisEvent[]>([]);

  // Keep subscriptions ref in sync without retriggering connect
  useEffect(() => {
    subscriptions.current = eventTypes;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      const events = eventTypes === '*' ? ['*'] : eventTypes;
      ws.send(JSON.stringify({ type: 'subscribe', events }));
    }
  }, [eventTypes]);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt.current = 0;
        setIsConnected(true);
        const events = subscriptions.current === '*' ? ['*'] : subscriptions.current;
        ws.send(JSON.stringify({ type: 'subscribe', events }));
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (cancelled) return;
        const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt.current);
        attempt.current += 1;
        reconnectTimer.current = setTimeout(connect, backoff);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (e) => {
        let msg: unknown;
        try {
          msg = JSON.parse(e.data as string);
        } catch {
          return;
        }
        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as { type?: unknown }).type === 'event'
        ) {
          const evt = msg as JarvisEvent;
          setLastEvent(evt);
          setEventHistory((prev) => {
            const next = [...prev, evt];
            return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
          });
        }
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  const emit = useCallback(
    (event: EventType, payload: Record<string, unknown> = {}, source = 'user') => {
      const ws = wsRef.current;
      if (ws?.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'bus_emit', event, payload, source }));
    },
    [],
  );

  return { lastEvent, isConnected, eventHistory, emit };
}
