'use client';
import { useState, type ReactNode, type CSSProperties } from 'react';
import { C, SANS } from './theme';

interface Props {
  title?: string;
  accent?: string;
  span?: number;
  rowSpan?: number;
  right?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}

// Frosted premium kart — kuvvetli blur, çok ince kenar, video arkadan sızar.
export function ClassicCard({ title, accent = C.mint, span = 1, rowSpan = 1, right, children, style }: Props) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        gridColumn: `span ${span}`,
        gridRow: rowSpan > 1 ? `span ${rowSpan}` : undefined,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '20px 22px',
        borderRadius: 20,
        background: hover ? 'rgba(20,22,32,0.52)' : 'rgba(16,18,26,0.42)',
        border: `1px solid ${hover ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.09)'}`,
        backdropFilter: 'blur(26px) saturate(140%)',
        WebkitBackdropFilter: 'blur(26px) saturate(140%)',
        boxShadow: hover
          ? `0 28px 70px -28px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.10)`
          : '0 20px 50px -30px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06)',
        transition: 'background 260ms ease, border-color 260ms ease, box-shadow 260ms ease, transform 260ms cubic-bezier(0.2,0.8,0.2,1)',
        transform: hover ? 'translateY(-3px)' : 'translateY(0)',
        fontFamily: SANS,
        color: C.text,
        overflow: 'hidden',
        minHeight: 0,
        ...style,
      }}
    >
      {/* köşe aksan parıltısı */}
      <div aria-hidden style={{
        position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: '50%',
        background: `radial-gradient(circle, ${accent}22, transparent 70%)`,
        opacity: hover ? 1 : 0.55, transition: 'opacity 260ms ease', pointerEvents: 'none',
      }} />
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, position: 'relative' }}>
          <span style={{
            fontSize: 10.5, fontWeight: 600, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: C.muted,
          }}>{title}</span>
          {right}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}
