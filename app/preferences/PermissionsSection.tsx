'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface PermState {
  state: 'granted' | 'denied' | 'unknown';
  source: string;
}
interface Resp {
  mic: PermState;
  camera: PermState;
  accessibility: PermState;
  fullDisk: PermState;
}

const ITEMS: { key: keyof Resp; label: string; openKey: string; hint: string }[] = [
  { key: 'mic',           label: 'Mikrofon',          openKey: 'mic',           hint: 'Wake word + Deepgram STT için.' },
  { key: 'camera',        label: 'Kamera',            openKey: 'camera',        hint: 'Vision sidecar / vision_analyze tool için.' },
  { key: 'accessibility', label: 'Accessibility',     openKey: 'accessibility', hint: 'AppleScript ile sistem kontrolü için (open, Calendar, Music…).' },
  { key: 'fullDisk',      label: 'Full Disk Access',  openKey: 'fulldisk',      hint: 'Mail, Messages gibi korumalı dizinlere erişim için (opsiyonel).' },
];

export function PermissionsSection() {
  const [state, setState] = useState<Resp | null>(null);

  const refresh = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/permissions/state`, { cache: 'no-store' });
      if (r.ok) setState(await r.json());
    } catch { /* offline */ }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  const open = async (which: string) => {
    await fetch(`${BACKEND}/api/permissions/open?which=${which}`, { method: 'POST' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: '0.75rem', opacity: 0.7, lineHeight: 1.6 }}>
        macOS sandbox izinleri programatik olarak okumaya izin vermez (Apple kısıtlaması).
        Tam liste için Full Disk Access bu sürece verilirse TCC.db okunur — yoksa &quot;bilinmiyor&quot;
        değeri normaldir. <b>System Settings…</b> butonuna tıklayıp ilgili paneli aç.
      </div>
      {ITEMS.map((it) => {
        const s = state?.[it.key];
        const status = s?.state ?? 'unknown';
        const color = status === 'granted' ? '#34d399'
                    : status === 'denied'  ? '#ef4444'
                    : '#71717a';
        const text = status === 'granted' ? '✓ izinli'
                   : status === 'denied'  ? '✗ reddedildi'
                   : '— bilinmiyor';
        return (
          <div
            key={it.key}
            style={{
              padding: '0.7rem 0.95rem',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(var(--hud-rgb),0.15)',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: '0.9rem' }}>{it.label}</span>
              <span style={{ color, fontSize: '0.78rem', fontFamily: 'monospace' }}>{text}</span>
              <button onClick={() => open(it.openKey)} style={ghostBtn}>System Settings…</button>
            </div>
            <div style={{ fontSize: '0.72rem', opacity: 0.6 }}>{it.hint}</div>
          </div>
        );
      })}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--hud-cyan, #00d4ff)',
  border: '1px solid rgba(var(--hud-rgb),0.4)',
  padding: '0.35rem 0.7rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.74rem',
};
