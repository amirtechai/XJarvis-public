'use client';

import { useEffect, useRef, useState } from 'react';
import { QuantumOrb } from '@/components/orb/QuantumOrb';
import { useJarvis } from '@/providers/JarvisProvider';

import { BACKEND } from '@/lib/backend';

interface Section {
  label: string;
  body?: string;
  items?: Array<{ time?: string; title: string }>;
  source: string;
}
interface Brief {
  greeting: string;
  timestamp: string;
  sections: Section[];
}

export function BriefingClient() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const jarvis = useJarvis();
  const ampRef = useRef(0);

  useEffect(() => {
    fetch(`${BACKEND}/api/briefing/now`).then((r) => r.json())
      .then((j) => { if (j.ok) setBrief(j); else setErr(j.error); })
      .catch((e) => setErr(e.message));
  }, []);

  const speakBriefing = () => {
    if (!brief) return;
    const text = [brief.greeting, ...brief.sections.map((s) => `${s.label}: ${s.body || (s.items || []).map((i) => `${i.time || ''} ${i.title}`).join(', ')}`)].join('. ');
    if (jarvis.connected) jarvis.send(`Speak this briefing aloud: ${text}`, 'voice_input');
    setSpeaking(true);
    setTimeout(() => setSpeaking(false), 60_000);
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: 0,
      background: 'radial-gradient(circle at center, #00131f 0%, #000610 70%)',
      padding: 30, gap: 30, position: 'relative', overflow: 'auto',
    }}>
      {/* Star particles bg */}
      <StarField />

      <div style={{ position: 'absolute', top: 24, left: 24 }}>
        <span className="hud-font" style={{ fontSize: 11, letterSpacing: '0.4em', color: 'var(--hud-cyan)' }}>
          ◢ DAILY BRIEFING
        </span>
      </div>

      <QuantumOrb state={speaking ? 'SPEAKING' : 'IDLE'} amplitude={ampRef.current} size={260} />

      {err && <div style={{ color: '#ff8888', fontSize: 13 }}>⚠ {err}</div>}

      {brief && (
        <>
          <h1 className="hud-font" style={{
            fontSize: 36, letterSpacing: '0.18em', color: 'var(--hud-cyan)',
            textShadow: '0 0 24px rgba(0,212,255,0.5)', margin: 0, fontWeight: 300,
          }}>{brief.greeting}</h1>

          <button
            onClick={speakBriefing} disabled={!jarvis.connected}
            style={{
              padding: '10px 28px', fontSize: 11, letterSpacing: '0.22em',
              background: 'rgba(var(--hud-rgb),0.18)',
              border: '1px solid rgba(var(--hud-rgb),0.5)',
              color: 'var(--hud-cyan)', borderRadius: 4,
              cursor: jarvis.connected ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
            }}
          >▶ SPEAK BRIEFING</button>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16, maxWidth: 1100, width: '100%',
          }}>
            {brief.sections.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, opacity: 0.6 }}>
                Henüz brief verisi yok. Sabah brifingi servisi ilk çalışmasını yaptıktan sonra dolacak.
              </div>
            )}
            {brief.sections.map((s, i) => (
              <div key={i} style={{
                padding: 18, borderRadius: 8,
                background: 'rgba(0,12,24,0.7)',
                border: '1px solid rgba(var(--hud-rgb),0.25)',
                backdropFilter: 'blur(8px)',
              }}>
                <div className="hud-font" style={{
                  fontSize: 10, letterSpacing: '0.22em', color: 'var(--hud-cyan)',
                  marginBottom: 10, fontWeight: 700,
                }}>{s.label.toUpperCase()}</div>
                {s.body && (
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {s.body}
                  </div>
                )}
                {s.items && (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {s.items.map((it, j) => (
                      <li key={j} style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                        <span style={{ color: 'var(--hud-cyan)', marginRight: 8, fontFamily: 'monospace' }}>
                          {it.time || '·'}
                        </span>
                        {it.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StarField() {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', opacity: 0.4 }}>
      {Array.from({ length: 60 }).map((_, i) => {
        const x = (i * 137.5) % 100;
        const y = (i * 73) % 100;
        const size = 1 + ((i * 13) % 3);
        const delay = (i * 0.13) % 4;
        return (
          <div key={i} style={{
            position: 'absolute', left: `${x}%`, top: `${y}%`,
            width: size, height: size, background: '#00d4ff', borderRadius: '50%',
            animation: `twinkle 3s ease-in-out ${delay}s infinite`,
            boxShadow: '0 0 8px #00d4ff',
          }} />
        );
      })}
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
