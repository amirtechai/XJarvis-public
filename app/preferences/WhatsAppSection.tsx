'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface WaState {
  deps_ok: boolean;
  deps_error?: string | null;
  connected: boolean;
  qr_pending: boolean;
  qr_data_url?: string | null;
  last_error?: string | null;
  inbox_count: number;
}

export function WhatsAppSection() {
  const [state, setState] = useState<WaState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    fetch(`${BACKEND}/api/whatsapp/state`).then((r) => r.json()).then(setState).catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const restart = async () => {
    if (!confirm('WhatsApp oturumu silinecek, tekrar QR taraman gerekecek. Devam?')) return;
    setBusy(true); setMsg(null);
    try {
      await fetch(`${BACKEND}/api/whatsapp/restart`, { method: 'POST' });
      setMsg('✓ Oturum sıfırlandı');
      load();
    } finally { setBusy(false); }
  };

  if (!state) return <div style={{ opacity: 0.6 }}>Yükleniyor…</div>;

  if (!state.deps_ok) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: '0.85rem', color: '#f59e0b' }}>
          Baileys kurulu değil. Aktive etmek için terminalde:
        </div>
        <pre style={{
          padding: '0.6rem 0.8rem',
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(var(--hud-rgb),0.2)',
          borderRadius: 6, fontSize: '0.78rem',
          color: '#67e8f9', fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
        }}>cd backend && npm install @whiskeysockets/baileys qrcode pino</pre>
        <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>
          Sonra backend'i yeniden başlat. Detay hatası: {state.deps_error}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          background: state.connected ? '#34d399' : state.qr_pending ? '#f59e0b' : '#ef4444',
          boxShadow: `0 0 8px ${state.connected ? '#34d399' : state.qr_pending ? '#f59e0b' : '#ef4444'}`,
        }} />
        <span style={{ fontSize: '0.9rem' }}>
          {state.connected ? 'Bağlı' : state.qr_pending ? 'QR bekliyor' : 'Bağlı değil'}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.7rem', opacity: 0.6, fontFamily: 'monospace' }}>
          inbox: {state.inbox_count}
        </span>
      </div>

      {state.qr_pending && state.qr_data_url && (
        <div style={{ textAlign: 'center', padding: 12 }}>
          <img src={state.qr_data_url} alt="WhatsApp QR" style={{ width: 240, height: 240 }} />
          <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: 8 }}>
            WhatsApp → Linked Devices → Link a Device → bu QR'ı tara
          </div>
        </div>
      )}

      {state.last_error && (
        <div style={{ fontSize: '0.78rem', color: '#fca5a5', fontFamily: 'monospace' }}>
          ✗ {state.last_error}
        </div>
      )}

      {msg && (
        <div style={{ fontSize: '0.8rem', color: msg.startsWith('✓') ? '#34d399' : '#ef4444' }}>
          {msg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={restart} disabled={busy} style={btnDanger}>
          Oturumu sıfırla
        </button>
      </div>

      <div style={{ fontSize: '0.7rem', opacity: 0.55 }}>
        Agent araçları: <code>whatsapp_send</code>, <code>whatsapp_recent</code>, <code>whatsapp_state</code>.
        JID format: <code>90555…@s.whatsapp.net</code> (DM) · <code>…@g.us</code> (grup).
      </div>
    </div>
  );
}

const btnDanger: React.CSSProperties = {
  background: 'transparent',
  color: '#ef4444',
  border: '1px solid rgba(239,68,68,0.4)',
  padding: '0.4rem 0.9rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.8rem',
};
