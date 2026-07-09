'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface Pending {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  created_at: number;
  age_sec: number;
}

export function ApprovalBanner() {
  const [items, setItems] = useState<Pending[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/agent/approvals`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setItems(j.pending || []);
      } catch { /* offline */ }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    await fetch(`${BACKEND}/api/agent/approvals/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision }),
    });
    setItems((prev) => prev.filter((p) => p.id !== id));
  };

  if (items.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 'calc(var(--navbar-h, 56px) + 8px)',
      right: 16,
      zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8,
      maxWidth: 420,
    }}>
      {items.map((p) => (
        <div key={p.id} style={{
          background: 'rgba(20,8,4,0.96)',
          border: '1px solid rgba(245,158,11,0.6)',
          borderRadius: 10,
          padding: '12px 14px',
          color: '#fde68a',
          fontFamily: 'var(--font-orbitron, monospace)',
          boxShadow: '0 0 24px rgba(245,158,11,0.3), 0 4px 18px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: '0.7rem', letterSpacing: '0.2em', opacity: 0.85, marginBottom: 6 }}>
            ⚠ ONAY GEREKLİ · {p.age_sec}s
          </div>
          <div style={{ fontSize: '0.95rem', fontFamily: 'monospace', marginBottom: 6 }}>
            {p.tool}({Object.entries(p.args).slice(0, 3).map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`).join(', ')})
          </div>
          {Object.keys(p.args).length > 0 && (
            <pre style={{
              fontSize: '0.7rem', opacity: 0.7,
              background: 'rgba(0,0,0,0.3)', padding: '6px 8px', borderRadius: 4,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflow: 'auto',
              margin: '6px 0',
            }}>{JSON.stringify(p.args, null, 2)}</pre>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => decide(p.id, 'rejected')} style={btnReject}>Reddet</button>
            <button onClick={() => decide(p.id, 'approved')} style={btnApprove}>Onayla</button>
          </div>
        </div>
      ))}
    </div>
  );
}

const btnApprove: React.CSSProperties = {
  background: '#34d399',
  color: '#02121d',
  border: 'none',
  padding: '6px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '0.8rem',
  letterSpacing: '0.05em',
};

const btnReject: React.CSSProperties = {
  background: 'transparent',
  color: '#fca5a5',
  border: '1px solid rgba(239,68,68,0.5)',
  padding: '6px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.8rem',
};
