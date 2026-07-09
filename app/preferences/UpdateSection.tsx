'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface UpdateInfo {
  ok: boolean;
  current: string;
  latest: string | null;
  has_update: boolean;
  release_notes_url?: string;
  notes?: string;
  error?: string;
}

export function UpdateSection() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${BACKEND}/api/update/check`);
      setInfo(await r.json());
    } finally { setBusy(false); }
  };

  const install = async () => {
    if (!confirm('Yeni sürümü indir + bağımlılıkları kur + Tauri yeniden derle? (yaklaşık 5-10 dk)')) return;
    setInstalling(true);
    try {
      await fetch(`${BACKEND}/api/update/install`, { method: 'POST' });
      alert('Background\'da başladı. Tamamlanınca XJarvis otomatik relaunch eder.');
    } finally { setInstalling(false); }
  };

  useEffect(() => { check(); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
        GitHub releases üzerinden son sürümü kontrol et. Install komutu git pull + npm run release çalıştırır.
      </div>

      {info && (
        <div style={{
          padding: 12, borderRadius: 6,
          background: info.has_update ? 'rgba(252,211,77,0.06)' : 'rgba(52,211,153,0.06)',
          border: `1px solid ${info.has_update ? 'rgba(252,211,77,0.4)' : 'rgba(52,211,153,0.3)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.16em' }}>CURRENT</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--hud-cyan)', fontFamily: 'monospace' }}>v{info.current}</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.16em', marginLeft: 12 }}>LATEST</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: info.has_update ? '#fbbf24' : '#34d399', fontFamily: 'monospace' }}>
              {info.latest || '?'}
            </span>
          </div>
          {info.has_update && (
            <button
              onClick={install} disabled={installing}
              style={{
                padding: '8px 18px', fontSize: 11, letterSpacing: '0.16em',
                background: 'rgba(252,211,77,0.2)', border: '1px solid #fbbf24',
                color: '#fbbf24', borderRadius: 4, cursor: 'pointer',
                fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
              }}
            >{installing ? 'INDIRILIYOR…' : '⬆ INSTALL UPDATE'}</button>
          )}
          {info.notes && (
            <pre style={{
              marginTop: 8, padding: 10, fontSize: 10, fontFamily: 'monospace',
              background: 'rgba(0,0,0,0.3)', borderRadius: 4,
              color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
              maxHeight: 200, overflow: 'auto',
            }}>{info.notes}</pre>
          )}
          {info.error && <div style={{ color: '#ff8888', fontSize: 11 }}>⚠ {info.error}</div>}
        </div>
      )}

      <button
        onClick={check} disabled={busy}
        style={{
          padding: '6px 14px', fontSize: 11, letterSpacing: '0.14em',
          background: 'rgba(0,212,255,0.1)', border: '1px solid var(--hud-cyan)',
          color: 'var(--hud-cyan)', borderRadius: 4, cursor: 'pointer',
          alignSelf: 'flex-start', fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
        }}
      >{busy ? '…' : '↻ CHECK NOW'}</button>
    </div>
  );
}
