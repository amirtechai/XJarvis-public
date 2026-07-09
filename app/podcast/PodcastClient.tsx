'use client';

import { useState } from 'react';

import { BACKEND } from '@/lib/backend';

export function PodcastClient() {
  const [topic, setTopic] = useState('');
  const [lengthMin, setLengthMin] = useState(5);
  const [script, setScript] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'scripting' | 'rendering'>('idle');
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    if (!topic.trim() || busy) return;
    setBusy(true); setStage('scripting'); setErr(null); setScript(''); setAudioPath(null);
    try {
      const r = await fetch(`${BACKEND}/api/podcast/script`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, length_min: lengthMin }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'script failed');
      setScript(j.script);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); setStage('idle'); }
  };

  const render = async () => {
    if (!script.trim() || busy) return;
    setBusy(true); setStage('rendering'); setErr(null); setAudioPath(null);
    try {
      const r = await fetch(`${BACKEND}/api/podcast/render`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'render failed');
      setAudioPath(j.path);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); setStage('idle'); }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 12, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
        display: 'flex', gap: 12, alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ AI PODCAST STUDIO</span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>2-host · ElevenLabs · ffmpeg concat</span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder="Konu: 'Quantum computing for absolute beginners'…"
          style={{
            flex: 1, padding: '10px 14px', fontSize: 14,
            background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', borderRadius: 4, fontFamily: 'inherit',
          }}
        />
        <select
          value={lengthMin} onChange={(e) => setLengthMin(parseInt(e.target.value, 10))}
          style={{
            padding: '10px 14px', fontSize: 12,
            background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', borderRadius: 4, fontFamily: 'inherit',
          }}
        >
          {[3, 5, 8, 10, 15].map((n) => <option key={n} value={n}>{n}dk</option>)}
        </select>
        <button
          onClick={generate} disabled={busy || !topic.trim()}
          style={primaryBtn(busy && stage === 'scripting' ? '…' : 'SCRIPT')}
        >{busy && stage === 'scripting' ? 'YAZILIYOR…' : '✍ SCRIPT'}</button>
        <button
          onClick={render} disabled={busy || !script.trim()}
          style={renderBtn}
        >{busy && stage === 'rendering' ? 'SES ÜRETİLİYOR…' : '▶ RENDER'}</button>
      </div>

      {err && <div style={{ padding: 10, background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff8888', fontSize: 11, borderRadius: 4 }}>⚠ {err}</div>}

      {audioPath && (
        <div style={{
          padding: 14, borderRadius: 6,
          background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.4)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ color: '#34d399', fontSize: 18 }}>♪</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: '#34d399', fontWeight: 700 }}>Podcast hazır!</div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{audioPath}</div>
          </div>
          <a
            href={`file://${audioPath}`}
            style={{
              padding: '6px 14px', fontSize: 11, letterSpacing: '0.14em',
              background: 'rgba(52,211,153,0.18)', border: '1px solid #34d399',
              color: '#34d399', borderRadius: 4, textDecoration: 'none',
              fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
            }}
          >▶ AÇ</a>
        </div>
      )}

      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        placeholder="Script burada görünecek. SCRIPT butonuna bas → düzenle → RENDER ile mp3 üretilir."
        style={{
          flex: 1, padding: 14, fontSize: 13, lineHeight: 1.6,
          background: 'rgba(0,8,20,0.45)', border: '1px solid rgba(var(--hud-rgb),0.18)',
          color: 'var(--text-primary)', borderRadius: 6,
          fontFamily: 'ui-monospace, "JetBrains Mono", monospace', resize: 'none', outline: 'none',
        }}
      />
    </div>
  );
}

function primaryBtn(_label: string): React.CSSProperties {
  return {
    padding: '10px 20px', fontSize: 11, letterSpacing: '0.16em',
    background: 'rgba(var(--hud-rgb),0.18)', border: '1px solid var(--hud-cyan)',
    color: 'var(--hud-cyan)', borderRadius: 4, cursor: 'pointer',
    fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
  };
}
const renderBtn: React.CSSProperties = {
  padding: '10px 20px', fontSize: 11, letterSpacing: '0.16em',
  background: 'rgba(178,102,255,0.18)', border: '1px solid #b266ff',
  color: '#b266ff', borderRadius: 4, cursor: 'pointer',
  fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
};
