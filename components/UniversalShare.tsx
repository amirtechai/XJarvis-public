'use client';

import { useState } from 'react';

import { BACKEND } from '@/lib/backend';

export interface ShareTarget {
  id: 'notion' | 'telegram' | 'drive' | 'clipboard' | 'email';
  label: string;
  icon: string;
}

const TARGETS: ShareTarget[] = [
  { id: 'clipboard', label: 'Clipboard',   icon: '📋' },
  { id: 'notion',    label: 'Notion',      icon: '◧'  },
  { id: 'telegram',  label: 'Telegram',    icon: '✈'  },
  { id: 'drive',     label: 'Drive',       icon: '☁'  },
  { id: 'email',     label: 'Email draft', icon: '✉'  },
];

interface Props {
  text: string;
  title?: string;
  compact?: boolean;
}

/**
 * Drop-in share button — küçük bir ikon, tıklayınca menü açar.
 * Her dashboard kartı, /research result, /briefing section vs. kullanabilir.
 */
export function UniversalShare({ text, title, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const dispatch = async (target: ShareTarget['id']) => {
    setBusy(target);
    try {
      switch (target) {
        case 'clipboard':
          await navigator.clipboard.writeText(text);
          setMsg('✓ kopyalandı');
          break;
        case 'notion': {
          // Need parent_id. Ask user once or pull from search.
          const r = await fetch(`${BACKEND}/api/notion/search?q=`).then((x) => x.json()).catch(() => null);
          const parent = r?.results?.find((p: { object?: string }) => p.object === 'page');
          if (!parent) { setMsg('⚠ Notion: paylaşılmış sayfa yok'); break; }
          await fetch(`${BACKEND}/api/notion/page`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: parent.id, title: title || 'XJarvis share', content: text }),
          });
          setMsg('✓ Notion\'a eklendi');
          break;
        }
        case 'telegram': {
          await fetch(`${BACKEND}/api/telegram/send`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: title ? `*${title}*\n\n${text}` : text }),
          });
          setMsg('✓ Telegram\'a yollandı');
          break;
        }
        case 'drive': {
          await fetch(`${BACKEND}/api/google/drive/upload`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `${title || 'xjarvis'}.txt`, content: text, mime: 'text/plain' }),
          });
          setMsg('✓ Drive\'a yüklendi');
          break;
        }
        case 'email': {
          await fetch(`${BACKEND}/api/google/gmail/draft`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: title || 'XJarvis note', body: text }),
          });
          setMsg('✓ Gmail draft hazır');
          break;
        }
      }
    } catch (e) {
      setMsg(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(null);
      setTimeout(() => { setMsg(null); setOpen(false); }, 1600);
    }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Paylaş"
        style={{
          padding: compact ? '2px 6px' : '4px 9px',
          fontSize: compact ? 10 : 11,
          background: 'rgba(0,212,255,0.08)',
          border: '1px solid rgba(var(--hud-rgb),0.3)',
          color: 'var(--hud-cyan)', borderRadius: 3, cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >→</button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4,
            display: 'flex', flexDirection: 'column', gap: 2,
            background: 'rgba(0,8,20,0.95)',
            border: '1px solid rgba(var(--hud-rgb),0.4)',
            borderRadius: 4, padding: 4,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            zIndex: 50,
            minWidth: 140,
          }}
        >
          {TARGETS.map((t) => (
            <button
              key={t.id}
              onClick={() => dispatch(t.id)}
              disabled={busy !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', fontSize: 11,
                background: busy === t.id ? 'rgba(var(--hud-rgb),0.18)' : 'transparent',
                border: 'none', color: 'var(--text-primary)',
                borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--hud-rgb),0.1)'; }}
              onMouseLeave={(e) => { if (busy !== t.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 13 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
          {msg && (
            <div style={{
              padding: '4px 8px', fontSize: 10,
              color: msg.startsWith('✓') ? '#34d399' : '#ff8888',
              borderTop: '1px solid rgba(var(--hud-rgb),0.18)', marginTop: 2,
            }}>{msg}</div>
          )}
        </div>
      )}
    </div>
  );
}
