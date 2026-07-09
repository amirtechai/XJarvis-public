'use client';
import type { ReactNode } from 'react';

interface EmptyProps {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function Empty({ icon, title, hint, action }: EmptyProps) {
  return (
    <div style={{
      textAlign: 'center', padding: '48px 24px',
      color: 'var(--text-secondary)',
    }}>
      {icon && <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.5 }}>{icon}</div>}
      <div className="hud-font" style={{
        fontSize: 13, letterSpacing: '0.18em', color: 'rgba(var(--hud-rgb),0.5)',
        marginBottom: 6, textTransform: 'uppercase',
      }}>{title}</div>
      {hint && <div style={{ fontSize: 12, marginBottom: 12 }}>{hint}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14, style = {} }: { width?: number | string; height?: number | string; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        width, height,
        background: 'linear-gradient(90deg, rgba(var(--hud-rgb),0.05), rgba(var(--hud-rgb),0.12), rgba(var(--hud-rgb),0.05))',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.4s ease-in-out infinite',
        borderRadius: 4,
        ...style,
      }}
    />
  );
}
