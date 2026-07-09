'use client';
import { useState } from 'react';
import { JarvisOrb } from '@/components/orb/JarvisOrb';
import { DashboardHamburger } from '@/components/dashboard/DashboardHamburger';

import { BACKEND } from '@/lib/backend';

const PRESETS = [
  { id: 'thumbnail', label: 'YouTube Thumbnail', tag: ' high contrast cinematic, 16:9 horizontal, bold subject', size: 'landscape_16_9' },
  { id: 'reel',      label: 'Instagram Reel Cover', tag: ' vertical 9:16, eye-catching, vibrant', size: 'portrait_16_9' },
  { id: 'product',   label: 'Ürün Fotoğrafı', tag: ' studio lighting, white background, professional product shot', size: 'square_hd' },
  { id: 'ad',        label: 'Reklam Görseli', tag: ' commercial photography, bold composition, brand-ready', size: 'landscape_4_3' },
  { id: 'avatar',    label: 'Avatar / Profil', tag: ' portrait, sharp focus, professional', size: 'square_hd' },
  { id: 'free',      label: 'Serbest', tag: '', size: 'square_hd' },
];

const MODELS = [
  { id: 'flux-schnell', label: 'Flux Schnell (hızlı, ucuz)' },
  { id: 'flux-dev',     label: 'Flux Dev (kaliteli)' },
  { id: 'flux-pro',     label: 'Flux Pro (en iyi)' },
  { id: 'sdxl',         label: 'SDXL (alternatif)' },
];

interface Generation { url: string; prompt: string; ts: number }

export function CreativeClient() {
  const [prompt, setPrompt] = useState('');
  const [preset, setPreset] = useState(PRESETS[0]);
  const [model, setModel] = useState('flux-schnell');
  const [busy, setBusy] = useState(false);
  const [gens, setGens] = useState<Generation[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const fullPrompt = prompt.trim() + (preset.tag || '');
      const r = await fetch(`${BACKEND}/api/fal/image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, model, image_size: preset.size }),
      }).then((res) => res.json());
      if (!r.ok || !r.url) {
        setErr(r.error || JSON.stringify(r.body || {}).slice(0, 200));
      } else {
        setGens((prev) => [{ url: r.url, prompt: fullPrompt, ts: Date.now() }, ...prev].slice(0, 12));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'fail');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: 'radial-gradient(circle at 50% 0%, rgba(10,4,24,0.55) 0%, rgba(3,3,10,0.72) 80%)',
      color: 'var(--hud-cyan)', fontFamily: 'var(--font-stack, monospace)',
    }}>
      {/* Stars */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0,
        backgroundImage: `radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.5), transparent),
          radial-gradient(1px 1px at 70% 80%, rgba(255,255,255,0.4), transparent),
          radial-gradient(1px 1px at 40% 70%, rgba(var(--hud-rgb),0.5), transparent),
          radial-gradient(1px 1px at 90% 20%, rgba(255,255,255,0.4), transparent),
          radial-gradient(1px 1px at 10% 90%, rgba(var(--hud-rgb),0.4), transparent)`,
        backgroundSize: '180px 180px',
        pointerEvents: 'none', opacity: 0.7,
      }} />

      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 18px',
        borderBottom: '1px solid rgba(var(--hud-rgb),0.2)',
        background: 'linear-gradient(180deg, rgba(0,12,24,0.92), rgba(0,12,24,0.4))',
      }}>
        <span style={{ fontSize: 11, letterSpacing: '0.3em', color: 'rgba(var(--hud-rgb),0.85)' }}>
          CREATIVE LAB · AI VISUAL GEN
        </span>
        <span style={{ fontSize: 13, color: '#9ed8ff', letterSpacing: '0.4em' }}>X J A R V I S</span>
        <DashboardHamburger />
      </div>

      <div style={{ position: 'absolute', top: 60, left: 12, right: 12, bottom: 12, display: 'grid', gridTemplateColumns: '320px 1fr', gap: 10 }}>
        {/* Sol — kontrol */}
        <div style={{
          border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4,
          background: 'rgba(0,12,28,0.7)', padding: 14,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.25em', opacity: 0.7, marginBottom: 6 }}>// PROMPT</div>
            <textarea
              value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder="Bir gece şehri silüeti, neon ışıklar, sinematik..."
              rows={4}
              style={{
                width: '100%', resize: 'vertical', minHeight: 80,
                background: 'rgba(0,8,18,0.85)', color: 'var(--hud-cyan)',
                border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 3,
                padding: 8, fontFamily: 'inherit', fontSize: 12, outline: 'none',
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.25em', opacity: 0.7, marginBottom: 6 }}>// PRESET</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => setPreset(p)}
                  style={{
                    padding: '6px 8px', fontSize: 10, letterSpacing: '0.1em',
                    background: preset.id === p.id ? 'rgba(var(--hud-rgb),0.18)' : 'rgba(0,8,18,0.6)',
                    border: `1px solid rgba(var(--hud-rgb),${preset.id === p.id ? 0.7 : 0.25})`,
                    color: 'var(--hud-cyan)', borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'inherit', textAlign: 'left',
                  }}
                >{p.label}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.25em', opacity: 0.7, marginBottom: 6 }}>// MODEL</div>
            <select value={model} onChange={(e) => setModel(e.target.value)}
              style={{
                width: '100%', padding: 6, fontSize: 11,
                background: 'rgba(0,8,18,0.85)', color: 'var(--hud-cyan)',
                border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 3,
                fontFamily: 'inherit',
              }}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>

          <button onClick={generate} disabled={busy || !prompt.trim()}
            style={{
              padding: '12px', fontSize: 12, letterSpacing: '0.3em',
              background: busy ? 'rgba(var(--hud-rgb),0.15)' : 'rgba(var(--hud-rgb),0.25)',
              border: '1px solid rgba(var(--hud-rgb),0.7)',
              color: 'var(--hud-cyan)', borderRadius: 3,
              cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
              textShadow: '0 0 8px rgba(var(--hud-rgb),0.6)',
              boxShadow: busy ? 'none' : '0 0 12px rgba(var(--hud-rgb),0.4)',
            }}
          >{busy ? '◐ ÜRETİLİYOR...' : '✦ ÜRET'}</button>

          {err && <div style={{ fontSize: 10, color: '#ef4444', wordBreak: 'break-all' }}>{err}</div>}

          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center' }}>
            <JarvisOrb size={120} />
          </div>
        </div>

        {/* Sağ — galeri */}
        <div style={{
          border: '1px solid rgba(var(--hud-rgb),0.25)', borderRadius: 4,
          background: 'rgba(0,4,12,0.5)',
          padding: 12, overflowY: 'auto',
        }}>
          {gens.length === 0 ? (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 12, opacity: 0.5,
            }}>
              <div style={{ fontSize: 48, opacity: 0.3 }}>✦</div>
              <div style={{ fontSize: 11, letterSpacing: '0.3em' }}>İLK ÜRETİMİNİ YAP</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {gens.map((g) => (
                <div key={g.ts} style={{ position: 'relative', borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(var(--hud-rgb),0.2)' }}>
                  <img src={g.url} alt={g.prompt} style={{ width: '100%', display: 'block' }} />
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.85))',
                    padding: '6px 8px', fontSize: 9, opacity: 0.85,
                    maxHeight: 60, overflow: 'hidden',
                  }}>{g.prompt.slice(0, 100)}</div>
                  <a href={g.url} download style={{
                    position: 'absolute', top: 4, right: 4,
                    background: 'rgba(0,0,0,0.7)', padding: '2px 6px',
                    fontSize: 9, color: '#fff', textDecoration: 'none',
                    border: '1px solid rgba(255,255,255,0.2)', borderRadius: 2,
                  }}>↓</a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
