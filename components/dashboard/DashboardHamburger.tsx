'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useWidgetVisibility } from '@/hooks/useWidgetVisibility';
import { WIDGET_CATALOG } from '@/lib/widget-catalog';

import { BACKEND } from '@/lib/backend';
const POLL_MS = 3000;

interface ControlState {
  camera: { on: boolean; available: boolean };
  mic:    { on: boolean; available: boolean };
  jarvis: { on: boolean; available: boolean };
  volume: number | null;
}

const LINKS = [
  // Scenes
  { href: '/dashboard',  label: 'Orbital HUD', icon: '◎' },
  { href: '/news',       label: 'News',        icon: '◇' },
  { href: '/world',      label: 'World Watch', icon: '◯' },
  { href: '/cyber',      label: 'Cyber',       icon: '▤' },
  { href: '/creative',   label: 'Creative',    icon: '✦' },
  { href: '/dev',        label: 'Dev',         icon: '◧' },
  { href: '/trading',    label: 'Trading',     icon: '◢' },
  // Tüm sayfalar (NavBar'daki tüm linkler)
  { href: '/',           label: 'Chat',        icon: '◈' },
  { href: '/history',    label: 'History',     icon: '◷' },
  { href: '/dictation',  label: 'Dictation',   icon: '✎' },
  { href: '/youtube',    label: 'Multi-TV',    icon: '▶' },
  { href: '/notion',     label: 'Notion',      icon: '◧' },
  { href: '/design',     label: 'Design',      icon: '✦' },
  { href: '/research',   label: 'Research',    icon: '⌕' },
  { href: '/agents',     label: 'Agents',      icon: '☷' },
  { href: '/tools',      label: 'Tools',       icon: '⊹' },
  { href: '/briefing',   label: 'Brief',       icon: '⇣' },
  { href: '/knowledge',  label: 'KGraph',      icon: '✣' },
  { href: '/companion',  label: 'Remote',      icon: '⌬' },
  { href: '/costs',      label: 'Cost',        icon: '$' },
  { href: '/replay',     label: 'Replay',      icon: '↻' },
  { href: '/crashes',    label: 'Crashes',     icon: '⚠' },
  { href: '/inbox',      label: 'Inbox',       icon: '✉' },
  { href: '/calendar-pro',label: 'Calendar+',  icon: '◫' },
  { href: '/podcast',    label: 'Podcast',     icon: '♪' },
  { href: '/whiteboard', label: 'Whiteboard',  icon: '✎' },
  { href: '/connectors', label: 'Connectors',  icon: '⚡' },
  { href: '/goals',      label: 'Goals',       icon: '◉' },
  { href: '/drafts',     label: 'Drafts',      icon: '✉' },
  { href: '/workflows',  label: 'Workflows',   icon: '⚙' },
  { href: '/logs',       label: 'Logs',        icon: '📜' },
  { href: '/health',     label: 'Health',      icon: '♥' },
  { href: '/preferences', label: 'Settings',   icon: '⚙' },
];

export function DashboardHamburger() {
  const [open, setOpen] = useState(false);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [state, setState] = useState<ControlState | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const { hidden, toggle } = useWidgetVisibility();

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/control/state`, { cache: 'no-store' });
        if (r.ok && alive) setState(await r.json());
      } catch { /* offline */ }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const post = async (path: string) => {
    try {
      await fetch(`${BACKEND}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const r = await fetch(`${BACKEND}/api/control/state`, { cache: 'no-store' });
      if (r.ok) setState(await r.json());
    } catch { /* noop */ }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Menü"
        style={{
          background: open ? 'rgba(var(--hud-rgb),0.15)' : 'transparent',
          border: '1px solid rgba(var(--hud-rgb),0.4)',
          color: 'var(--hud-cyan, #00d4ff)',
          width: 28, height: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', borderRadius: 4,
          fontSize: 13, lineHeight: 1,
          letterSpacing: 0,
        }}
      >☰</button>

      {open && (
        <div
          className="hud-font"
          style={{
            position: 'absolute', top: 30, right: 0,
            minWidth: 220,
            maxHeight: 'calc(100vh - 60px)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            background: 'linear-gradient(180deg, rgba(2,14,28,0.97), rgba(0,8,20,0.97))',
            border: '1px solid rgba(var(--hud-rgb),0.35)',
            borderRadius: 6,
            boxShadow: '0 0 22px rgba(var(--hud-rgb),0.22), inset 0 0 24px rgba(0,80,140,0.18)',
            padding: 6,
            zIndex: 50,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(var(--hud-rgb),0.4) transparent',
          }}
        >
          {LINKS.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 10px',
                fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                color: 'var(--text-secondary)', textDecoration: 'none',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(var(--hud-rgb),0.08)';
                e.currentTarget.style.color = 'var(--hud-cyan)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <span style={{ width: 14, color: 'rgba(var(--hud-rgb),0.7)' }}>{icon}</span>
              <span>{label}</span>
            </Link>
          ))}

          {/* Widgets toggle bölümü */}
          <div style={{
            marginTop: 6, paddingTop: 6,
            borderTop: '1px solid rgba(var(--hud-rgb),0.18)',
          }}>
            <button
              onClick={() => setWidgetsOpen((v) => !v)}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px',
                background: 'transparent', border: 'none',
                color: 'var(--hud-cyan, #00d4ff)',
                fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                fontFamily: 'inherit', cursor: 'pointer',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--hud-rgb),0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ width: 14, color: 'rgba(var(--hud-rgb),0.7)' }}>▣</span>
                <span>Widgets</span>
              </span>
              <span style={{ opacity: 0.5 }}>{widgetsOpen ? '▾' : '▸'}</span>
            </button>
            {widgetsOpen && (
              <div style={{
                maxHeight: 260, overflowY: 'auto',
                margin: '4px 4px 8px',
                padding: '6px 4px',
                background: 'rgba(0,8,20,0.5)',
                border: '1px solid rgba(var(--hud-rgb),0.12)',
                borderRadius: 4,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                {/* Layout actions */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 6, padding: '0 4px' }}>
                  <button
                    onClick={() => {
                      // Tüm xjarvis:widget:* anahtarlarını listele, sonra bunlardan bir snapshot al
                      const snap: Record<string, string> = {};
                      for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k && k.startsWith('xjarvis:widget:')) snap[k] = localStorage.getItem(k) || '';
                      }
                      localStorage.setItem('xjarvis:layout:snapshot', JSON.stringify({ ts: Date.now(), data: snap }));
                      alert(`✓ ${Object.keys(snap).length} widget yerleşimi kaydedildi`);
                    }}
                    style={{
                      flex: 1, padding: '4px 8px', fontSize: 9, letterSpacing: '0.15em',
                      background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.4)',
                      color: '#34d399', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >💾 LAYOUT KAYDET</button>
                  <button
                    onClick={() => {
                      const raw = localStorage.getItem('xjarvis:layout:snapshot');
                      if (!raw) return alert('Snapshot yok — önce kaydet.');
                      try {
                        const { data } = JSON.parse(raw) as { data: Record<string, string> };
                        for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
                        location.reload();
                      } catch { alert('Snapshot bozuk'); }
                    }}
                    style={{
                      flex: 1, padding: '4px 8px', fontSize: 9, letterSpacing: '0.15em',
                      background: 'rgba(var(--hud-rgb),0.08)', border: '1px solid rgba(var(--hud-rgb),0.4)',
                      color: 'var(--hud-cyan)', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >↩ GERİ YÜKLE</button>
                  <button
                    onClick={() => {
                      if (!confirm('Tüm widget yerleşim ve boyutları sıfırlansın mı?')) return;
                      const toDel: string[] = [];
                      for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k && k.startsWith('xjarvis:widget:')) toDel.push(k);
                      }
                      toDel.forEach((k) => localStorage.removeItem(k));
                      location.reload();
                    }}
                    style={{
                      flex: 1, padding: '4px 8px', fontSize: 9, letterSpacing: '0.15em',
                      background: 'rgba(255,77,109,0.08)', border: '1px solid rgba(255,77,109,0.45)',
                      color: '#f87171', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >✕ SIFIRLA</button>
                </div>
                {WIDGET_CATALOG.map((w) => {
                  const visible = !hidden.has(w.id);
                  return (
                    <button
                      key={w.id}
                      onClick={() => toggle(w.id)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '4px 8px',
                        background: 'transparent', border: 'none',
                        color: visible ? 'var(--text-primary)' : '#52525b',
                        fontSize: 10, letterSpacing: '0.08em',
                        fontFamily: 'inherit', cursor: 'pointer',
                        borderRadius: 3,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--hud-rgb),0.06)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          width: 14, height: 14,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          border: `1px solid ${visible ? 'rgba(var(--hud-rgb),0.6)' : 'rgba(255,255,255,0.18)'}`,
                          background: visible ? 'rgba(var(--hud-rgb),0.18)' : 'transparent',
                          color: 'var(--hud-cyan, #00d4ff)',
                          borderRadius: 3, fontSize: 10, lineHeight: 1,
                        }}>{visible ? '✓' : ''}</span>
                        <span>{w.label}</span>
                      </span>
                      {w.group === 'ext' && (
                        <span style={{ fontSize: 8, color: 'rgba(var(--hud-rgb),0.5)', letterSpacing: '0.1em' }}>NEW</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{
            marginTop: 4, paddingTop: 6,
            borderTop: '1px solid rgba(var(--hud-rgb),0.18)',
            display: 'flex', gap: 6, justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 8px 4px',
          }}>
            <StatusBadge label="J" on={state?.jarvis.on ?? false} dim={!state} onClick={() => post('/api/control/jarvis')} title="XJarvis" />
            <StatusBadge label="📷" on={state?.camera.on ?? false} dim={!state?.camera.available} onClick={() => post('/api/control/camera')} title="Kamera" />
            <StatusBadge label="🎤" on={state?.mic.on ?? false} dim={!state?.mic.available} onClick={() => post('/api/control/mic')} title="Mikrofon" />
            <span title={`Sistem ses: ${state?.volume ?? '—'}%`} style={{
              fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace',
              padding: '2px 6px', borderRadius: 4, background: 'rgba(var(--hud-rgb),0.08)',
              border: '1px solid rgba(var(--hud-rgb),0.2)',
            }}>🔊 {state?.volume ?? '—'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ label, on, dim, onClick, title }: {
  label: string; on: boolean; dim?: boolean; onClick: () => void; title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={dim}
      style={{
        width: 32, height: 24,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12,
        background: on ? 'rgba(var(--hud-rgb), 0.18)' : 'transparent',
        border: `1px solid ${on ? 'rgba(var(--hud-rgb), 0.5)' : 'rgba(255,255,255,0.12)'}`,
        color: on ? '#00d4ff' : (dim ? '#52525b' : 'var(--text-secondary)'),
        borderRadius: 4,
        cursor: dim ? 'not-allowed' : 'pointer',
        opacity: dim ? 0.5 : 1,
      }}
    >{label}</button>
  );
}
