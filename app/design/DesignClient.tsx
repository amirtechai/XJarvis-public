'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { BACKEND } from '@/lib/backend';
const LS_HISTORY = 'xjarvis:design:history';

interface Generation {
  id: string;
  ts: number;
  prompt: string;
  model: string;
  aspect: string;
  url: string;
}

const MODELS = [
  { id: 'flux-schnell', label: 'Flux Schnell', desc: 'hızlı + ucuz' },
  { id: 'flux-dev',     label: 'Flux Dev',     desc: 'denge' },
  { id: 'flux-pro',     label: 'Flux Pro',     desc: 'en kaliteli' },
  { id: 'sdxl',         label: 'SDXL Fast',    desc: 'klasik' },
];

const ASPECTS = [
  { id: 'square_hd',       label: '1:1 HD',  ratio: 1 / 1 },
  { id: 'square',          label: '1:1',     ratio: 1 / 1 },
  { id: 'portrait_4_3',    label: '3:4',     ratio: 3 / 4 },
  { id: 'portrait_16_9',   label: '9:16',    ratio: 9 / 16 },
  { id: 'landscape_4_3',   label: '4:3',     ratio: 4 / 3 },
  { id: 'landscape_16_9',  label: '16:9',    ratio: 16 / 9 },
];

const STYLES = [
  { id: 'none',     label: 'Düz',         injection: '' },
  { id: 'logo',     label: 'Logo',        injection: ', vector logo, flat, minimal, white background, centered, professional brand identity' },
  { id: 'photo',    label: 'Foto',        injection: ', photorealistic, high detail, natural lighting, 4k' },
  { id: 'cinematic',label: 'Sinema',      injection: ', cinematic lighting, film grain, dramatic atmosphere, 35mm' },
  { id: '3d',       label: '3D',          injection: ', 3d render, octane, blender, soft lighting' },
  { id: 'anime',    label: 'Anime',       injection: ', anime style, studio ghibli, vibrant colors' },
  { id: 'icon',     label: 'İkon',        injection: ', flat icon, simple shapes, white background, single subject, app icon style' },
  { id: 'thumb',    label: 'Thumbnail',   injection: ', youtube thumbnail, bold, eye-catching, high contrast, clear focal point' },
];

const FAVICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 512];

function loadHistory(): Generation[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) || '[]'); } catch { return []; }
}
function saveHistory(arr: Generation[]) {
  try { localStorage.setItem(LS_HISTORY, JSON.stringify(arr.slice(0, 30))); } catch { /* noop */ }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

async function downloadImageAs(url: string, filename: string) {
  try {
    const r = await fetch(url);
    const blob = await r.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    // fallback: open in new tab
    window.open(url, '_blank');
  }
}

async function exportFaviconPack(imgUrl: string) {
  const img = await loadImage(imgUrl);
  for (const size of FAVICON_SIZES) {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(img, 0, 0, size, size);
    const dataUrl = canvas.toDataURL('image/png');
    downloadDataUrl(dataUrl, `favicon-${size}x${size}.png`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function exportSocialPack(imgUrl: string) {
  const img = await loadImage(imgUrl);
  const variants: Array<[string, number, number]> = [
    ['1x1', 1080, 1080],
    ['16x9', 1920, 1080],
    ['9x16', 1080, 1920],
    ['4x5', 1080, 1350],
  ];
  for (const [label, w, h] of variants) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    // cover crop
    const scale = Math.max(w / img.width, h / img.height);
    const sw = w / scale, sh = h / scale;
    const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    downloadDataUrl(canvas.toDataURL('image/png'), `social-${label}.png`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function DesignClient() {
  const [model, setModel] = useState('flux-schnell');
  const [aspect, setAspect] = useState('square_hd');
  const [style, setStyle] = useState('none');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [removingBg, setRemovingBg] = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const [current, setCurrent] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setHistory(loadHistory()); }, []);

  const styleObj = useMemo(() => STYLES.find((s) => s.id === style) || STYLES[0], [style]);

  const generate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true); setError(null);
    try {
      const fullPrompt = prompt + styleObj.injection;
      const r = await fetch(`${BACKEND}/api/design/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, model, image_size: aspect }),
      });
      const d = await r.json();
      if (!d.ok || !d.url) throw new Error(d.error || d.body?.detail || 'üretim başarısız');
      const gen: Generation = {
        id: `gen_${Date.now()}`, ts: Date.now(),
        prompt: fullPrompt, model: d.model || model, aspect, url: d.url,
      };
      setCurrent(gen);
      setHistory((prev) => {
        const next = [gen, ...prev].slice(0, 30);
        saveHistory(next); return next;
      });
    } catch (e) { setError((e as Error).message); }
    finally { setGenerating(false); }
  }, [prompt, generating, model, aspect, styleObj]);

  const removeBg = useCallback(async () => {
    if (!current || removingBg) return;
    setRemovingBg(true); setError(null);
    try {
      const r = await fetch(`${BACKEND}/api/design/remove-bg`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: current.url }),
      });
      const d = await r.json();
      if (!d.ok || !d.url) throw new Error(d.error || 'BG kaldırma başarısız');
      const gen: Generation = { ...current, id: `gen_${Date.now()}`, ts: Date.now(), url: d.url, prompt: current.prompt + ' [no-bg]' };
      setCurrent(gen);
      setHistory((prev) => { const next = [gen, ...prev].slice(0, 30); saveHistory(next); return next; });
    } catch (e) { setError((e as Error).message); }
    finally { setRemovingBg(false); }
  }, [current, removingBg]);

  const upscale = useCallback(async () => {
    if (!current || upscaling) return;
    setUpscaling(true); setError(null);
    try {
      const r = await fetch(`${BACKEND}/api/design/upscale`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: current.url, factor: 2 }),
      });
      const d = await r.json();
      if (!d.ok || !d.url) throw new Error(d.error || 'upscale başarısız');
      const gen: Generation = { ...current, id: `gen_${Date.now()}`, ts: Date.now(), url: d.url, prompt: current.prompt + ' [4k]' };
      setCurrent(gen);
      setHistory((prev) => { const next = [gen, ...prev].slice(0, 30); saveHistory(next); return next; });
    } catch (e) { setError((e as Error).message); }
    finally { setUpscaling(false); }
  }, [current, upscaling]);

  const onPromptKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate(); }
  };

  return (
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr 240px', minHeight: 0, background: 'var(--bg-base)' }}>
      {/* LEFT — controls */}
      <aside style={{ borderRight: '1px solid rgba(var(--hud-rgb),0.18)', overflowY: 'auto', padding: 14, background: 'rgba(0,8,20,0.45)' }}>
        <Section title="MODEL">
          {MODELS.map((m) => (
            <Pill key={m.id} active={model === m.id} onClick={() => setModel(m.id)}>
              <span style={{ fontWeight: 600 }}>{m.label}</span>
              <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 6 }}>{m.desc}</span>
            </Pill>
          ))}
        </Section>
        <Section title="ASPECT">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {ASPECTS.map((a) => (
              <Pill key={a.id} active={aspect === a.id} onClick={() => setAspect(a.id)}>{a.label}</Pill>
            ))}
          </div>
        </Section>
        <Section title="STYLE">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {STYLES.map((s) => (
              <Pill key={s.id} active={style === s.id} onClick={() => setStyle(s.id)}>{s.label}</Pill>
            ))}
          </div>
        </Section>
      </aside>

      {/* CENTER — canvas + prompt */}
      <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ flex: 1, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, position: 'relative' }}>
          {generating ? (
            <Loading label={`${MODELS.find((m) => m.id === model)?.label || model} üretiyor…`} />
          ) : current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.url} alt={current.prompt}
              style={{
                maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                borderRadius: 6, boxShadow: '0 0 36px rgba(var(--hud-rgb),0.18)',
                background: 'repeating-conic-gradient(#222 0% 25%, #1a1a1a 0% 50%) 50% / 24px 24px',
              }}
            />
          ) : (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.4 }}>✦</div>
              Aşağıya prompt yaz, ⌘↵ ile üret.
            </div>
          )}
        </div>

        {error && (
          <div style={{ padding: '8px 16px', background: 'rgba(255,80,80,0.1)', color: '#ff8888', fontSize: 11, borderTop: '1px solid rgba(255,80,80,0.3)' }}>
            ⚠ {error}
          </div>
        )}

        {history.length > 0 && (
          <div style={{
            padding: '8px 16px', borderTop: '1px solid rgba(var(--hud-rgb),0.1)',
            display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0, background: 'rgba(0,0,0,0.25)',
          }}>
            {history.map((h) => (
              <button
                key={h.id} onClick={() => setCurrent(h)}
                style={{
                  flexShrink: 0, width: 56, height: 56, padding: 0,
                  border: `1px solid ${current?.id === h.id ? 'rgba(var(--hud-rgb),0.7)' : 'transparent'}`,
                  borderRadius: 4, cursor: 'pointer', background: '#000', overflow: 'hidden',
                }}
                title={h.prompt}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={h.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
            ))}
          </div>
        )}

        <div style={{ borderTop: '1px solid rgba(var(--hud-rgb),0.18)', padding: 12, background: 'rgba(0,8,20,0.55)' }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onPromptKey}
            placeholder="Modern logo, blue tones, minimal, geometric…   (⌘↵ üret)"
            rows={3}
            style={{
              width: '100%', padding: 10, fontSize: 13,
              background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', borderRadius: 4, fontFamily: 'inherit',
              resize: 'none', outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={generate} disabled={generating || !prompt.trim()}
              style={{
                padding: '9px 22px', fontSize: 11, letterSpacing: '0.18em',
                background: 'rgba(var(--hud-rgb),0.22)', border: '1px solid rgba(var(--hud-rgb),0.55)',
                color: 'var(--hud-cyan)', borderRadius: 4,
                cursor: generating ? 'wait' : 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >{generating ? '…' : '▶ ÜRET'}</button>
          </div>
        </div>
      </main>

      {/* RIGHT — export */}
      <aside style={{ borderLeft: '1px solid rgba(var(--hud-rgb),0.18)', overflowY: 'auto', padding: 14, background: 'rgba(0,8,20,0.45)' }}>
        <Section title="SKILLS">
          <ActionBtn disabled={!current || removingBg} onClick={removeBg}>
            {removingBg ? '…' : '⊘ BG Sil'}
          </ActionBtn>
          <ActionBtn disabled={!current || upscaling} onClick={upscale}>
            {upscaling ? '…' : '⇧ Upscale 2×'}
          </ActionBtn>
        </Section>

        <Section title="EXPORT">
          <ActionBtn disabled={!current} onClick={() => current && downloadImageAs(current.url, `xjarvis-${current.id}.png`)}>
            ⬇ PNG
          </ActionBtn>
          <ActionBtn disabled={!current} onClick={() => current && downloadImageAs(current.url, `xjarvis-${current.id}.jpg`)}>
            ⬇ JPG (orig)
          </ActionBtn>
          <ActionBtn disabled={!current} onClick={() => current && exportFaviconPack(current.url)}>
            ⬇ Favicon Pack
          </ActionBtn>
          <ActionBtn disabled={!current} onClick={() => current && exportSocialPack(current.url)}>
            ⬇ Social Pack
          </ActionBtn>
        </Section>

        {current && (
          <Section title="META">
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, fontFamily: 'ui-monospace, monospace' }}>
              <div>model: {current.model}</div>
              <div>aspect: {current.aspect}</div>
              <div>ts: {new Date(current.ts).toLocaleTimeString()}</div>
            </div>
          </Section>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="hud-font" style={{ fontSize: 9, letterSpacing: '0.22em', color: 'var(--hud-cyan)', marginBottom: 6, opacity: 0.8 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', padding: '6px 10px', fontSize: 11,
        background: active ? 'rgba(var(--hud-rgb),0.18)' : 'transparent',
        border: `1px solid ${active ? 'rgba(var(--hud-rgb),0.5)' : 'var(--border)'}`,
        color: active ? 'var(--hud-cyan)' : 'var(--text-secondary)',
        borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
      }}
    >{children}</button>
  );
}

function ActionBtn({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      disabled={disabled} onClick={onClick}
      style={{
        padding: '7px 10px', fontSize: 11, letterSpacing: '0.1em',
        background: disabled ? 'transparent' : 'rgba(var(--hud-rgb),0.1)',
        border: '1px solid var(--border)',
        color: disabled ? 'var(--text-secondary)' : 'var(--hud-cyan)',
        borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', textAlign: 'left', opacity: disabled ? 0.45 : 1,
      }}
    >{children}</button>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div style={{ textAlign: 'center', color: 'var(--hud-cyan)' }}>
      <div style={{
        width: 56, height: 56, margin: '0 auto 16px',
        border: '2px solid rgba(var(--hud-rgb),0.2)',
        borderTopColor: 'var(--hud-cyan)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <div style={{ fontSize: 11, letterSpacing: '0.16em' }}>{label}</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
