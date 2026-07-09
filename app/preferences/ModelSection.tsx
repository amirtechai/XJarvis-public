'use client';
import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface ModelPreset {
  id: string;
  label: string;
  full: string;
  desc: string;
  price: string;
  color: string;
}

// Tıklanınca anında geçer — agent.service yeni LLM_DEFAULT'u sonraki çağrıda okur.
const MODELS: ModelPreset[] = [
  { id: 'haiku',    label: 'Claude Haiku 4.5',  full: 'anthropic/claude-haiku-4-5',    desc: 'Hızlı · ekonomik · default',  price: '$1 / $5',   color: '#34d399' },
  { id: 'sonnet',   label: 'Claude Sonnet 4.6', full: 'anthropic/claude-sonnet-4-6',   desc: 'Dengeli · güçlü reasoning',    price: '$3 / $15',  color: '#7dd3fc' },
  { id: 'opus',     label: 'Claude Opus 4.7',   full: 'anthropic/claude-opus-4-7',     desc: 'En güçlü · ağır görevler',     price: '$15 / $75', color: '#a78bfa' },
  { id: 'gemini',   label: 'Gemini 2.5 Flash',  full: 'google/gemini-2.5-flash',       desc: 'Hızlı · ucuz · çok dilli',      price: '$0.30',     color: '#fbbf24' },
  { id: 'flash',    label: 'Gemini Flash Lite', full: 'google/gemini-2.5-flash-lite',  desc: 'Ultra ucuz · düşük gecikme',   price: '$0.10',     color: '#fdba74' },
  { id: 'deepseek', label: 'DeepSeek V3.2',     full: 'deepseek/deepseek-v3.2',        desc: 'Açık kaynak · güçlü',          price: '$0.25',     color: '#f472b6' },
];

export function ModelSection() {
  const [active, setActive] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/agent/model`).then((r) => r.json()).then((d) => {
      if (d?.model) setActive(d.model);
    }).catch(() => {});
  }, []);

  const switchModel = async (m: ModelPreset) => {
    if (busy) return;
    setBusy(m.id);
    try {
      const r = await fetch(`${BACKEND}/api/agent/model`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id }),
      }).then((res) => res.json());
      if (r?.model) {
        setActive(r.model);
        setSavedAt(Date.now());
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em', marginBottom: 4 }}>
        Aktif: <span style={{ color: 'var(--hud-cyan)' }}>{active || '—'}</span>
        <span style={{ marginLeft: 8, opacity: 0.5 }}>· Anahtar Sonnet/Haiku/Opus için OpenRouter API üzerinden, .env'de güvenle saklanıyor</span>
      </div>
      {MODELS.map((m) => {
        const isActive = m.full === active;
        const isBusy = busy === m.id;
        return (
          <button
            key={m.id}
            onClick={() => switchModel(m)}
            disabled={isBusy}
            style={{
              padding: '10px 14px',
              border: `1px solid ${isActive ? m.color : m.color + '40'}`,
              borderLeft: `3px solid ${m.color}`,
              borderRadius: 5,
              background: isActive ? `${m.color}18` : 'rgba(0,0,0,0.25)',
              color: 'var(--hud-cyan)',
              fontFamily: 'inherit',
              fontSize: 12,
              letterSpacing: '0.08em',
              textAlign: 'left',
              cursor: isBusy ? 'wait' : 'pointer',
              opacity: isBusy ? 0.5 : 1,
              transition: 'background 120ms, border-color 120ms',
              display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: isActive ? m.color : '#444', boxShadow: isActive ? `0 0 8px ${m.color}` : 'none' }} />
            <span style={{ minWidth: 200, color: m.color, fontWeight: 700 }}>{m.label}</span>
            <span style={{ flex: 1, opacity: 0.65, fontSize: 11 }}>{m.desc}</span>
            <span style={{ fontSize: 10, opacity: 0.5, fontFamily: 'monospace' }}>{m.price}/1M</span>
            {isActive && <span style={{ fontSize: 10, color: m.color, letterSpacing: '0.2em' }}>● AKTİF</span>}
          </button>
        );
      })}
      {savedAt && Date.now() - savedAt < 5000 && (
        <div style={{ fontSize: 10, color: '#34d399', textAlign: 'center', letterSpacing: '0.2em', marginTop: 6 }}>
          ✓ MODEL DEĞİŞTİ
        </div>
      )}
    </div>
  );
}
