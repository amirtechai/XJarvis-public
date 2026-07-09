'use client';

import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

import { BACKEND } from '@/lib/backend';

interface PrepResp {
  ok: boolean;
  event?: {
    summary?: string;
    start_time?: string;
    start?: string;
    attendees?: Array<{ email?: string }>;
  };
  prep?: string;
  error?: string;
}

export function CalendarPrepWidget({ position }: { position: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [data, setData] = useState<PrepResp | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/calendar-prep/next`, { cache: 'no-store' });
      setData(await r.json());
    } catch { /* offline */ } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <WidgetShell title="Next Meeting" position={position}>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {loading && !data && <span style={{ fontSize: '0.6rem', opacity: 0.5 }}>yükleniyor…</span>}
        {data?.ok && data.event && (
          <>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--hud-cyan)', lineHeight: 1.3 }}>
              {data.event.summary || '(no title)'}
            </div>
            <div style={{ fontSize: '0.55rem', opacity: 0.6, fontFamily: 'monospace' }}>
              {data.event.start_time || data.event.start}
            </div>
            {data.prep && (
              <div style={{ fontSize: '0.6rem', lineHeight: 1.45, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', maxHeight: 110, overflow: 'auto' }}>
                {data.prep}
              </div>
            )}
          </>
        )}
        {data && !data.ok && (
          <span style={{ fontSize: '0.55rem', opacity: 0.5 }}>
            {data.error === 'no upcoming events' ? 'Yaklaşan toplantı yok' : data.error}
          </span>
        )}
      </div>
    </WidgetShell>
  );
}
