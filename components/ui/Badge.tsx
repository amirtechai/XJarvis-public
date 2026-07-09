'use client';
import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

const palettes: Record<string, { bg: string; border: string; text: string }> = {
  default: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.18)', text: 'var(--text-secondary)' },
  success: { bg: 'rgba(0,255,136,0.06)', border: 'rgba(0,255,136,0.45)', text: '#00ff88' },
  warning: { bg: 'rgba(255,179,71,0.06)', border: 'rgba(255,179,71,0.45)', text: '#ffb347' },
  danger:  { bg: 'rgba(255,77,109,0.06)', border: 'rgba(255,77,109,0.45)', text: '#ff4d6d' },
  info:    { bg: 'rgba(var(--hud-rgb),0.06)', border: 'rgba(var(--hud-rgb),0.45)', text: 'var(--hud-cyan)' },
};

export function Badge({ children, variant = 'default' }: BadgeProps) {
  const p = palettes[variant];
  return (
    <span className="hud-font" style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 3,
      background: p.bg, border: `1px solid ${p.border}`, color: p.text,
      fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase',
      fontWeight: 600,
    }}>
      {children}
    </span>
  );
}
