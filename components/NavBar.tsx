'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';
const POLL_MS = 3000;

interface ControlState {
  camera: { on: boolean; available: boolean };
  mic:    { on: boolean; available: boolean };
  jarvis: { on: boolean; available: boolean };
  volume: number | null;
}

const LINKS = [
  { href: '/', label: 'Chat', icon: '◈' },
  { href: '/dashboard', label: 'HUD', icon: '◐' },
  { href: '/history', label: 'History', icon: '◷' },
  { href: '/dictation', label: 'Dictation', icon: '✎' },
  { href: '/youtube', label: 'Multi-TV', icon: '▶' },
  { href: '/notion', label: 'Notion', icon: '◧' },
  { href: '/design', label: 'Design', icon: '✦' },
  { href: '/research', label: 'Research', icon: '⌕' },
  { href: '/agents', label: 'Agents', icon: '☷' },
  { href: '/tools', label: 'Tools', icon: '⊹' },
  { href: '/briefing', label: 'Brief', icon: '⇣' },
  { href: '/knowledge', label: 'KGraph', icon: '✣' },
  { href: '/companion', label: 'Remote', icon: '⌬' },
  { href: '/costs', label: 'Cost', icon: '$' },
  { href: '/replay', label: 'Replay', icon: '↻' },
  { href: '/crashes', label: 'Crashes', icon: '⚠' },
  { href: '/inbox', label: 'Inbox', icon: '✉' },
  { href: '/calendar-pro', label: 'Calendar+', icon: '◫' },
  { href: '/podcast', label: 'Podcast', icon: '♪' },
  { href: '/whiteboard', label: 'Board', icon: '✎' },
  { href: '/connectors', label: 'Connectors', icon: '⚡' },
  { href: '/goals', label: 'Goals', icon: '◎' },
  { href: '/drafts', label: 'Drafts', icon: '✉' },
  { href: '/workflows', label: 'Workflows', icon: '⚙' },
  { href: '/logs', label: 'Logs', icon: '▤' },
  { href: '/health', label: 'Health', icon: '♥' },
  { href: '/preferences', label: 'Settings', icon: '⚙' },
];

export function NavBar() {
  const pathname = usePathname();
  const [state, setState] = useState<ControlState | null>(null);

  useEffect(() => {
    let alive = true;
    const fetch1 = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/control/state`, { cache: 'no-store' });
        if (r.ok && alive) setState(await r.json());
      } catch {
        if (alive) setState(null);
      }
    };
    fetch1();
    const id = setInterval(fetch1, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const post = async (path: string, body: object = {}) => {
    try {
      await fetch(`${BACKEND}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const r = await fetch(`${BACKEND}/api/control/state`, { cache: 'no-store' });
      if (r.ok) setState(await r.json());
    } catch { /* noop */ }
  };

  return (
    <nav className="app-nav hud-glass-new" style={{
      display: 'flex',
      gap: 2,
      padding: '8px 18px',
      borderBottom: '1px solid var(--glass-border)',
      flexShrink: 0,
      alignItems: 'center',
      boxShadow: '0 1px 24px rgba(0,217,255,0.08)',
      backdropFilter: 'var(--glass-blur)',
      WebkitBackdropFilter: 'var(--glass-blur)',
    }}>
      <div className="hud-font hud-glow" style={{
        fontSize: 14, fontWeight: 700, color: '#00d9ff',
        marginRight: 18, letterSpacing: '0.32em',
      }}>
        ◢ XJARVIS
      </div>
      {LINKS.map(({ href, label, icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className="hud-font"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 5,
              fontSize: 11,
              letterSpacing: '0.14em',
              textDecoration: 'none',
              textTransform: 'uppercase',
              background: active ? 'rgba(0, 217, 255, 0.12)' : 'transparent',
              color: active ? '#00d9ff' : '#9fb3c8',
              border: active ? '1px solid rgba(0, 217, 255, 0.35)' : '1px solid transparent',
              boxShadow: active ? 'inset 0 0 12px rgba(0, 217, 255, 0.08)' : 'none',
              transition: 'color 120ms ease, background 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
              position: 'relative',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.color = '#f0f0f0';
                e.currentTarget.style.background = 'rgba(0, 217, 255, 0.08)';
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.color = '#9fb3c8';
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span style={{ fontSize: 11 }}>{icon}</span>
            {label}
          </Link>
        );
      })}

      {/* Live status badges (right-aligned) */}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Badge
          label="J"
          tooltip={`XJarvis: ${state?.jarvis.on ? 'açık' : 'kapalı'} (tıkla)`}
          on={state?.jarvis.on ?? false}
          dim={!state}
          onClick={() => post('/api/control/jarvis')}
        />
        <Badge
          label="📷"
          tooltip={`Kamera: ${state?.camera.on ? 'açık' : 'kapalı'} (tıkla)`}
          on={state?.camera.on ?? false}
          dim={!state?.camera.available}
          onClick={() => post('/api/control/camera')}
        />
        <Badge
          label="🎤"
          tooltip={`Mikrofon: ${state?.mic.on ? 'açık' : 'kapalı'} (tıkla)`}
          on={state?.mic.on ?? false}
          dim={!state?.mic.available}
          onClick={() => post('/api/control/mic')}
        />
        {state?.volume != null && (
          <span
            title={`Sistem ses seviyesi: ${state.volume}%`}
            style={{
              fontSize: 11,
              color: '#9fb3c8',
              fontFamily: 'var(--font-stack)',
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(0, 217, 255, 0.08)',
            }}
          >
            🔊 {state.volume}
          </span>
        )}
      </div>
    </nav>
  );
}

function Badge({ label, tooltip, on, dim, onClick }: {
  label: string;
  tooltip: string;
  on: boolean;
  dim?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={tooltip}
      onClick={onClick}
      disabled={dim}
      style={{
        width: 28, height: 22,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12,
        background: on ? 'rgba(0, 217, 255, 0.15)' : 'transparent',
        border: `1px solid ${on ? 'rgba(0, 217, 255, 0.45)' : 'rgba(159, 179, 200, 0.2)'}`,
        color: on ? '#00d9ff' : (dim ? '#64748b' : '#9fb3c8'),
        borderRadius: 6,
        cursor: dim ? 'not-allowed' : 'pointer',
        opacity: dim ? 0.5 : 1,
        transition: 'all 120ms',
        boxShadow: on ? 'inset 0 0 8px rgba(0, 217, 255, 0.1)' : 'none',
      }}
    >
      {label}
    </button>
  );
}
