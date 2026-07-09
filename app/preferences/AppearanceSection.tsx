'use client';
import { useEffect, useState } from 'react';
import { PALETTES, FONTS, THEME_PRESETS, applyPreset, useTheme } from '@/hooks/useTheme';

export function AppearanceSection() {
  const { palette, font, setPalette, setFont } = useTheme();
  const [activePreset, setActivePreset] = useState<string>('');

  useEffect(() => {
    setActivePreset(localStorage.getItem('xjarvis:theme:preset') || '');
  }, []);

  const pickPreset = (id: string) => {
    applyPreset(id);
    setActivePreset(id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6, letterSpacing: '0.2em' }}>HAZIR TEMALAR</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {THEME_PRESETS.map((t) => {
            const active = t.id === activePreset;
            const accent = t.accent || '0, 212, 255';
            return (
              <button
                key={t.id}
                onClick={() => pickPreset(t.id)}
                style={{
                  padding: '10px 12px',
                  background: active ? `rgba(${accent}, 0.18)` : t.bgElev,
                  border: `1px solid ${active ? `rgb(${accent})` : 'rgba(255,255,255,0.12)'}`,
                  borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    width: 12, height: 12, borderRadius: '50%',
                    background: `rgb(${accent})`, boxShadow: `0 0 8px rgb(${accent})`,
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: t.textPrimary, letterSpacing: '0.08em' }}>{t.label}</span>
                </div>
                <div style={{ fontSize: 10, color: t.textSecondary, lineHeight: 1.35 }}>
                  {t.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6, letterSpacing: '0.2em' }}>RENK PALETİ</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {PALETTES.map((p) => {
            const active = p.id === palette;
            return (
              <button
                key={p.id}
                onClick={() => setPalette(p.id)}
                style={{
                  padding: '10px 8px',
                  background: active ? `rgba(${p.rgb}, 0.18)` : 'rgba(0,0,0,0.3)',
                  border: `1px solid rgba(${p.rgb}, ${active ? 0.9 : 0.35})`,
                  borderRadius: 6,
                  color: `rgb(${p.rgb})`,
                  fontFamily: 'inherit',
                  fontSize: 11,
                  letterSpacing: '0.15em',
                  cursor: 'pointer',
                  textShadow: active ? `0 0 8px rgba(${p.rgb}, 0.7)` : 'none',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: `rgb(${p.rgb})`,
                  margin: '0 auto 6px',
                  boxShadow: `0 0 12px rgba(${p.rgb}, 0.7)`,
                }} />
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6, letterSpacing: '0.2em' }}>YAZI KARAKTERİ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {FONTS.map((f) => {
            const active = f.id === font;
            return (
              <button
                key={f.id}
                onClick={() => setFont(f.id)}
                style={{
                  padding: '8px 12px',
                  background: active ? 'rgba(var(--hud-rgb), 0.15)' : 'rgba(0,0,0,0.25)',
                  border: `1px solid rgba(var(--hud-rgb), ${active ? 0.7 : 0.25})`,
                  borderRadius: 4,
                  color: 'var(--hud-cyan)',
                  fontFamily: f.stack,
                  fontSize: 13,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {active ? '● ' : '○ '}{f.label} — Patron, JARVIS dinliyor.
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
