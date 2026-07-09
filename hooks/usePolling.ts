'use client';
import { useEffect, useRef, useState } from 'react';

interface PollingState<T> {
  data: T | null;
  error: Error | null;
  cached: boolean;
  lastUpdated: number | null;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  cacheKey?: string,
): PollingState<T> {
  const [state, setState] = useState<PollingState<T>>({
    data: null, error: null, cached: false, lastUpdated: null,
  });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;

    if (cacheKey && typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(cacheKey);
        if (raw) {
          const { data, ts } = JSON.parse(raw) as { data: T; ts: number };
          setState({ data, error: null, cached: true, lastUpdated: ts });
        }
      } catch { /* ignore cache errors */ }
    }

    const run = async () => {
      try {
        const data = await fetcherRef.current();
        if (cancelled) return;
        const ts = Date.now();
        setState({ data, error: null, cached: false, lastUpdated: ts });
        if (cacheKey && typeof window !== 'undefined') {
          try { window.localStorage.setItem(cacheKey, JSON.stringify({ data, ts })); } catch { /* ignore */ }
        }
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({ ...s, error: err as Error }));
      }
    };

    run();
    const t = setInterval(run, intervalMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [intervalMs, cacheKey]);

  return state;
}
