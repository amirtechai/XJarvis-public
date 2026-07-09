'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface Persona {
  id: string;
  label: string;
  description: string;
  style_hint: string;
  voice: { mac: string; eleven: string; lang: string };
}

export function PersonaSection() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [active, setActive] = useState<string>('jarvis-classic');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/persona/list`);
      const j = await r.json();
      if (j.ok) {
        setPersonas(j.personas || []);
        setActive(j.active || 'jarvis-classic');
      }
    } catch { /* noop */ }
  };

  useEffect(() => { load(); }, []);

  const activate = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${BACKEND}/api/persona/activate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (j.ok) {
        setActive(id);
        setMsg('✓ aktive edildi — voice service restart önerilir');
      } else {
        setMsg(j.error || 'failed');
      }
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
        Persona seçimi — agent&apos;ın üslubu, sesi ve dilini değiştirir. Aktivasyon
        sonrası voice servisini yeniden başlat (tray → Restart) sesin değişmesi için.
      </div>

      {msg && (
        <div style={{
          padding: '6px 10px', fontSize: 11,
          background: msg.startsWith('✓') ? 'rgba(52,211,153,0.08)' : 'rgba(255,80,80,0.08)',
          color: msg.startsWith('✓') ? '#34d399' : '#ff8888',
          border: `1px solid ${msg.startsWith('✓') ? 'rgba(52,211,153,0.3)' : 'rgba(255,80,80,0.3)'}`,
          borderRadius: 4,
        }}>{msg}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {personas.map((p) => {
          const isActive = active === p.id;
          return (
            <div key={p.id} style={{
              padding: 14, borderRadius: 8,
              background: isActive ? 'rgba(52,211,153,0.06)' : 'rgba(0,0,0,0.2)',
              border: `1px solid ${isActive ? 'rgba(52,211,153,0.4)' : 'rgba(var(--hud-rgb),0.18)'}`,
              cursor: busy ? 'wait' : 'pointer',
              transition: 'all 120ms',
            }} onClick={() => !busy && activate(p.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {isActive && <span style={{ color: '#34d399' }}>✓</span>}
                <span style={{ fontSize: 14, fontWeight: 700, color: isActive ? '#34d399' : 'var(--text-primary)' }}>
                  {p.label}
                </span>
                <span style={{
                  marginLeft: 'auto', fontSize: 9, padding: '2px 6px',
                  background: 'rgba(var(--hud-rgb),0.1)', border: '1px solid rgba(var(--hud-rgb),0.3)',
                  borderRadius: 10, color: 'var(--hud-cyan)', letterSpacing: '0.1em',
                }}>{p.voice.lang.toUpperCase()}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: 8 }}>
                {p.description}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-secondary)', opacity: 0.6, fontFamily: 'monospace' }}>
                voice: {p.voice.mac} · ele: {p.voice.eleven.slice(0, 8)}…
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
