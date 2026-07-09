'use client';
import type { ReactNode, CSSProperties } from 'react';

interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit';
  fullWidth?: boolean;
  style?: CSSProperties;
}

export function Button({
  children, variant = 'secondary', size = 'md', disabled, loading,
  onClick, type = 'button', fullWidth, style,
}: ButtonProps) {
  const sizes = {
    sm: { padding: '4px 10px', fontSize: 11, letterSpacing: '0.12em' },
    md: { padding: '7px 16px', fontSize: 12, letterSpacing: '0.14em' },
  };

  const variants: Record<string, CSSProperties> = {
    primary: {
      background: 'linear-gradient(180deg, rgba(var(--hud-rgb),0.25), rgba(var(--hud-rgb),0.10))',
      border: '1px solid rgba(var(--hud-rgb),0.55)',
      color: 'var(--hud-cyan)',
      textShadow: '0 0 8px rgba(var(--hud-rgb),0.5)',
      boxShadow: '0 0 12px rgba(var(--hud-rgb),0.18), inset 0 0 8px rgba(var(--hud-rgb),0.08)',
    },
    secondary: {
      background: 'rgba(var(--hud-rgb),0.04)',
      border: '1px solid rgba(var(--hud-rgb),0.22)',
      color: 'var(--text-primary)',
    },
    ghost: {
      background: 'transparent',
      border: '1px solid transparent',
      color: 'var(--text-secondary)',
    },
    danger: {
      background: 'rgba(255,77,109,0.06)',
      border: '1px solid rgba(255,77,109,0.45)',
      color: 'var(--hud-red)',
    },
  };

  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      className="hud-font"
      style={{
        ...variants[variant],
        ...sizes[size],
        borderRadius: 6,
        fontWeight: 600,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.5 : 1,
        transition: 'transform 120ms ease, border-color 120ms ease, background 120ms ease',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        width: fullWidth ? '100%' : undefined,
        justifyContent: 'center',
        ...style,
      }}
      onMouseDown={(e) => { if (!isDisabled) e.currentTarget.style.transform = 'scale(0.97)'; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 11, height: 11,
      border: '1.5px solid currentColor', borderTopColor: 'transparent',
      borderRadius: '50%', animation: 'hud-spin-slow 0.8s linear infinite',
    }} />
  );
}
