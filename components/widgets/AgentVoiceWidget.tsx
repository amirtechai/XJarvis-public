'use client';
import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

import { BACKEND } from '@/lib/backend';

interface VoicePreset {
  id: string;       // ElevenLabs voice_id
  label: string;    // UI adı
  desc: string;     // tonu/karakteri
  color: string;
}

// Yaygın ElevenLabs preset voice ID'leri. Tıklandığında anında geçer,
// voice service kickstart ile yeniden başlar (yeni voice_id .env'den okunur).
const VOICES: VoicePreset[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George',   desc: 'JARVIS · British male', color: '#7dd3fc' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam',     desc: 'Deep · narration',      color: '#a78bfa' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni',   desc: 'Warm · friendly',       color: '#fbbf24' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold',   desc: 'Crisp · authoritative', color: '#f87171' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh',     desc: 'Young · energetic',     color: '#34d399' },
  { id: 'IKne3meq5aSn9XLyUdCD', label: 'Charlie',  desc: 'Casual · Australian',   color: '#60a5fa' },
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel',   desc: 'Female · calm',         color: '#f472b6' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella',    desc: 'Female · soft',         color: '#fb7185' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi',     desc: 'Female · confident',    color: '#c084fc' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli',     desc: 'Female · young',        color: '#facc15' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam',      desc: 'Male · raspy',          color: '#fdba74' },
  { id: 'LcfcDJNUP1GQjkzn1xUU', label: 'Emily',    desc: 'Female · British',      color: '#fda4af' },
];

export function AgentVoiceWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restartedAt, setRestartedAt] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/voice/state`).then((r) => r.json()).then((d) => {
      if (d?.eleven_voice_id) setActive(d.eleven_voice_id);
    }).catch(() => {});
  }, []);

  const switchVoice = async (v: VoicePreset) => {
    if (busy) return;
    setBusy(v.id);
    try {
      // .env'i güncelle (ELEVENLABS_VOICE_ID)
      await fetch(`${BACKEND}/api/voice/set`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eleven_voice_id: v.id }),
      });
      // Voice servisini kickstart — yeni voice ID .env'den okunsun
      await fetch(`${BACKEND}/api/services/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'voice' }),
      });
      setActive(v.id);
      setRestartedAt(Date.now());
    } finally {
      setBusy(null);
    }
  };

  const preview = async (v: VoicePreset, e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(`p:${v.id}`);
    try {
      // /api/voice/eleven-preview — küçük bir cümle çal
      await fetch(`${BACKEND}/api/voice/eleven/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: v.id, text: 'Merhaba patron, ben JARVIS. Bu sesi nasıl buldun?' }),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <WidgetShell title="Voice" position={position} width={320}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.62rem', width: '100%', maxHeight: 240, overflowY: 'auto' }}>
        {VOICES.map((v) => {
          const isActive = v.id === active;
          const isBusy = busy === v.id;
          return (
            <div
              key={v.id}
              onClick={() => switchVoice(v)}
              style={{
                padding: '0.32rem 0.5rem',
                border: `1px solid ${isActive ? v.color : v.color + '40'}`,
                borderLeft: `3px solid ${v.color}`,
                borderRadius: 4,
                background: isActive ? `${v.color}18` : 'rgba(0,0,0,0.25)',
                display: 'flex', alignItems: 'center', gap: 8,
                cursor: 'pointer',
                opacity: isBusy ? 0.5 : 1,
                transition: 'background 120ms, border-color 120ms',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: isActive ? v.color : '#444', boxShadow: isActive ? `0 0 8px ${v.color}` : 'none' }} />
              <span style={{ fontWeight: 700, color: v.color, letterSpacing: '0.05em', minWidth: 56 }}>{v.label}</span>
              <span style={{ flex: 1, opacity: 0.6, fontSize: '0.55rem' }}>{v.desc}</span>
              <button
                onClick={(e) => preview(v, e)}
                title="Önizle"
                style={{
                  background: 'transparent', border: `1px solid ${v.color}50`,
                  color: v.color, fontSize: 9, padding: '1px 5px', borderRadius: 3,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >▶</button>
            </div>
          );
        })}
      </div>
      {restartedAt && Date.now() - restartedAt < 6000 && (
        <div style={{ marginTop: 6, fontSize: '0.55rem', color: '#34d399', textAlign: 'center', letterSpacing: '0.15em' }}>
          ✓ SES DEĞİŞTİ
        </div>
      )}
    </WidgetShell>
  );
}
