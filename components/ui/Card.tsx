'use client';
import type { ReactNode, CSSProperties } from 'react';

interface CardProps {
  children: ReactNode;
  variant?: 'default' | 'glass' | 'flat';
  hoverable?: boolean;
  glow?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
}

/**
 * HUD-style card — glassmorphic with cyan corner brackets when glow=true.
 */
export function Card({ children, variant = 'glass', hoverable = false, glow = false, style, onClick }: CardProps) {
  const base: CSSProperties = {
    position: 'relative',
    borderRadius: 8,
    padding: 16,
    transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
    cursor: onClick ? 'pointer' : 'default',
  };

  const variantStyle: Record<string, CSSProperties> = {
    default: {
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
    },
    glass: {
      background: 'linear-gradient(135deg, rgba(var(--hud-rgb),0.04), rgba(var(--hud-rgb),0.01))',
      border: '1px solid rgba(var(--hud-rgb),0.18)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      boxShadow: glow
        ? '0 0 0 1px rgba(var(--hud-rgb),0.08), 0 0 22px rgba(var(--hud-rgb),0.15), inset 0 0 18px rgba(0,90,140,0.12)'
        : '0 0 0 1px rgba(var(--hud-rgb),0.04), inset 0 0 12px rgba(0,90,140,0.06)',
    },
    flat: {
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
    },
  };

  return (
    <div
      onClick={onClick}
      style={{ ...base, ...variantStyle[variant], ...style }}
      onMouseEnter={hoverable ? (e) => {
        e.currentTarget.style.borderColor = 'rgba(var(--hud-rgb),0.45)';
        e.currentTarget.style.boxShadow = '0 0 0 1px rgba(var(--hud-rgb),0.18), 0 0 28px rgba(var(--hud-rgb),0.32), inset 0 0 18px rgba(0,90,140,0.12)';
      } : undefined}
      onMouseLeave={hoverable ? (e) => {
        e.currentTarget.style.borderColor = variantStyle[variant].border?.toString().includes('cyan') ? 'rgba(var(--hud-rgb),0.18)' : 'var(--border)';
        e.currentTarget.style.boxShadow = (variantStyle[variant] as { boxShadow?: string }).boxShadow || '';
      } : undefined}
    >
      {variant === 'glass' && <CornerBrackets />}
      {children}
    </div>
  );
}

function CornerBrackets() {
  const c = 'rgba(var(--hud-rgb),0.4)';
  const len = 7;
  const off = 4;
  const w = 1.2;
  const common: CSSProperties = { position: 'absolute', width: len, height: len, pointerEvents: 'none' };
  return (
    <>
      <div aria-hidden style={{ ...common, top: off, left: off, borderTop: `${w}px solid ${c}`, borderLeft: `${w}px solid ${c}` }} />
      <div aria-hidden style={{ ...common, top: off, right: off, borderTop: `${w}px solid ${c}`, borderRight: `${w}px solid ${c}` }} />
      <div aria-hidden style={{ ...common, bottom: off, left: off, borderBottom: `${w}px solid ${c}`, borderLeft: `${w}px solid ${c}` }} />
      <div aria-hidden style={{ ...common, bottom: off, right: off, borderBottom: `${w}px solid ${c}`, borderRight: `${w}px solid ${c}` }} />
    </>
  );
}
