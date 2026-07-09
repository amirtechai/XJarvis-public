'use client';
import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

import { BACKEND } from '@/lib/backend';

interface NotionPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}

function extractTitle(page: NotionPage): string {
  const props = page.properties as Record<string, { title?: Array<{ plain_text?: string }> }> | undefined;
  if (!props) return '(başlıksız)';
  for (const v of Object.values(props)) {
    const arr = v?.title;
    if (Array.isArray(arr) && arr[0]?.plain_text) return arr[0].plain_text;
  }
  return '(başlıksız)';
}

export function NotionNotesWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [pages, setPages] = useState<NotionPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/notion/search?q=`, { cache: 'no-store' });
        const d = await r.json();
        if (!alive) return;
        if (!d.ok) { setError(d.error || 'fetch failed'); return; }
        setError(null);
        setPages((d.results || []).slice(0, 5));
      } catch (e) { if (alive) setError((e as Error).message); }
    };
    tick();
    const id = setInterval(tick, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <WidgetShell title="Notion" position={position} width={220} height={180}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.6rem', width: '100%', textAlign: 'left' }}>
        {error && <span style={{ opacity: 0.6, color: '#ef4444' }}>{error}</span>}
        {!error && pages === null && <span style={{ opacity: 0.5 }}>loading…</span>}
        {!error && pages && pages.length === 0 && <span style={{ opacity: 0.5 }}>sonuç yok</span>}
        {!error && pages?.map((p) => {
          const title = extractTitle(p);
          const date = p.last_edited_time ? new Date(p.last_edited_time).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) : '';
          return (
            <a
              key={p.id}
              href={p.url} target="_blank" rel="noreferrer"
              style={{ display: 'flex', justifyContent: 'space-between', gap: 6, color: 'inherit', textDecoration: 'none', borderBottom: '1px dashed rgba(var(--hud-rgb),0.1)', paddingBottom: 2 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--hud-cyan, #00d4ff)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'inherit'; }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{title}</span>
              <span style={{ opacity: 0.5, fontFamily: 'monospace' }}>{date}</span>
            </a>
          );
        })}
      </div>
    </WidgetShell>
  );
}
