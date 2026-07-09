'use client';
import type { ReactNode } from 'react';

interface PageProps {
  title: string;
  subtitle?: string;
  icon?: string;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: number;
}

/**
 * Standard page container — header with HUD-style accent, max-width body.
 * Used by /goals, /drafts, /workflows, /quick-capture, etc.
 */
export function Page({ title, subtitle, icon, actions, children, maxWidth = 920 }: PageProps) {
  return (
    <div style={{ padding: '24px 32px 48px', maxWidth, margin: '0 auto', color: 'var(--text-primary)' }}>
      <header style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 16, marginBottom: 24, paddingBottom: 16,
        borderBottom: '1px solid rgba(var(--hud-rgb),0.18)',
      }}>
        <div>
          <h1 className="hud-font" style={{
            fontSize: 22, fontWeight: 600, letterSpacing: '0.18em',
            color: 'var(--hud-cyan)', textShadow: '0 0 12px rgba(var(--hud-rgb),0.45)',
            margin: 0,
          }}>
            {icon && <span style={{ marginRight: 10 }}>{icon}</span>}
            {title.toUpperCase()}
          </h1>
          {subtitle && (
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)', marginTop: 6,
              letterSpacing: '0.06em',
            }}>
              {subtitle}
            </div>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
      </header>
      <main>{children}</main>
    </div>
  );
}

interface SectionProps { title?: string; children: ReactNode; right?: ReactNode }

export function Section({ title, children, right }: SectionProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      {(title || right) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 10,
        }}>
          {title && (
            <h2 className="hud-font" style={{
              fontSize: 11, fontWeight: 500, letterSpacing: '0.22em',
              color: 'rgba(var(--hud-rgb),0.7)', margin: 0,
            }}>
              // {title.toUpperCase()}
            </h2>
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}
