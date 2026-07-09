'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Variant = 'info' | 'success' | 'warning' | 'error';
interface Toast { id: number; message: string; variant: Variant; ttl: number }

const ToastCtx = createContext<{ push: (msg: string, variant?: Variant, ttl?: number) => void }>({
  push: () => {},
});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((message: string, variant: Variant = 'info', ttl = 4000) => {
    const id = nextId++;
    setItems((s) => [...s, { id, message, variant, ttl }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), ttl);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div style={{
        position: 'fixed', top: 70, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none',
      }}>
        {items.map((t) => <ToastItem key={t.id} toast={t} />)}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

function ToastItem({ toast }: { toast: Toast }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const colors: Record<Variant, { border: string; glow: string; icon: string }> = {
    info: { border: 'rgba(var(--hud-rgb),0.55)', glow: 'rgba(var(--hud-rgb),0.25)', icon: 'ⓘ' },
    success: { border: 'rgba(0,255,136,0.55)', glow: 'rgba(0,255,136,0.25)', icon: '✓' },
    warning: { border: 'rgba(255,179,71,0.55)', glow: 'rgba(255,179,71,0.25)', icon: '⚠' },
    error: { border: 'rgba(255,77,109,0.55)', glow: 'rgba(255,77,109,0.25)', icon: '✕' },
  };
  const c = colors[toast.variant];

  return (
    <div
      className="hud-font"
      style={{
        background: 'linear-gradient(135deg, rgba(2,18,32,0.94), rgba(0,8,20,0.96))',
        border: `1px solid ${c.border}`,
        borderRadius: 6,
        padding: '10px 14px',
        minWidth: 240,
        maxWidth: 380,
        color: 'var(--text-primary)',
        fontSize: 12,
        letterSpacing: '0.04em',
        boxShadow: `0 0 0 1px ${c.glow}, 0 8px 24px rgba(0,0,0,0.5), 0 0 16px ${c.glow}`,
        display: 'flex', alignItems: 'flex-start', gap: 10,
        pointerEvents: 'auto',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateX(0)' : 'translateX(20px)',
        transition: 'opacity 220ms ease, transform 220ms ease',
      }}
    >
      <span style={{ color: c.border, fontSize: 14, flexShrink: 0, marginTop: 1 }}>{c.icon}</span>
      <span>{toast.message}</span>
    </div>
  );
}
