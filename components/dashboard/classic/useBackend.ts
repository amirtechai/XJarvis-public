'use client';
import { useEffect, useRef, useState } from 'react';

export { BACKEND } from '@/lib/backend';

// Basit polling hook — async fn'i interval ile çalıştırır, son veri + hata döner.
export function usePoll<T>(fn: () => Promise<T>, ms: number): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const v = await fnRef.current();
        if (alive) { setData(v); setError(false); }
      } catch {
        if (alive) setError(true);
      }
    };
    run();
    const id = setInterval(run, ms);
    return () => { alive = false; clearInterval(id); };
  }, [ms]);

  return { data, error };
}

export async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`fetch ${url} ${r.status}`);
  return r.json() as Promise<T>;
}
