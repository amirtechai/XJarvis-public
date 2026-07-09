'use client';

import { useEffect, useRef, useState } from 'react';
import { UniversalShare } from '@/components/UniversalShare';

import { BACKEND } from '@/lib/backend';

interface Stroke {
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
}

const PALETTE = ['#00d4ff', '#fbbf24', '#34d399', '#ff6688', '#b266ff', '#ffffff'];

export function WhiteboardClient() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState('#00d4ff');
  const [width, setWidth] = useState(2);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(0, 5, 15, 1)';
    ctx.fillRect(0, 0, w, h);
    // Grid
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.06)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // Replay strokes
    for (const s of strokes) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      s.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
    }
  }, [strokes]);

  const start = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    setDrawing(true);
    setStrokes((prev) => [...prev, { points: [{ x: e.clientX - rect.left, y: e.clientY - rect.top }], color, width }]);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    setStrokes((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      return [...prev.slice(0, -1), { ...last, points: [...last.points, { x: e.clientX - rect.left, y: e.clientY - rect.top }] }];
    });
  };
  const end = () => setDrawing(false);

  const clear = () => { setStrokes([]); setAiResult(null); };
  const undo = () => setStrokes((p) => p.slice(0, -1));

  const analyze = async () => {
    const canvas = canvasRef.current;
    if (!canvas || strokes.length === 0) return;
    setAnalyzing(true); setAiResult(null);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const r = await fetch(`${BACKEND}/api/vision-detect/describe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: dataUrl }),
      });
      const j = await r.json();
      setAiResult(j.text || j.error || 'no result');
    } catch (e) { setAiResult(`error: ${(e as Error).message}`); }
    finally { setAnalyzing(false); }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 12, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ WHITEBOARD</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {PALETTE.map((c) => (
            <button key={c} onClick={() => setColor(c)} style={{
              width: 22, height: 22, borderRadius: '50%',
              background: c, border: color === c ? '2px solid white' : '1px solid rgba(255,255,255,0.18)',
              cursor: 'pointer',
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[1, 2, 4, 8, 16].map((w) => (
            <button key={w} onClick={() => setWidth(w)} style={{
              width: 28, height: 22, fontSize: 11,
              background: width === w ? 'rgba(var(--hud-rgb),0.25)' : 'transparent',
              border: '1px solid var(--border)', color: 'var(--text-primary)',
              borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
            }}>{w}</button>
          ))}
        </div>
        <button onClick={undo} style={ghostBtn}>↶ Undo</button>
        <button onClick={clear} style={dangerBtn}>✕ Clear</button>
        <button onClick={analyze} disabled={analyzing || strokes.length === 0} style={primaryBtn}>
          {analyzing ? 'AI ANALİZ…' : '✦ AI: Bu nedir?'}
        </button>
        {aiResult && <UniversalShare text={aiResult} title="Whiteboard sketch analysis" compact />}
      </div>

      {aiResult && (
        <div style={{
          padding: 12, borderRadius: 6,
          background: 'rgba(178,102,255,0.06)', border: '1px solid rgba(178,102,255,0.4)',
          color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.5,
        }}>{aiResult}</div>
      )}

      <div style={{ flex: 1, position: 'relative', borderRadius: 6, overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
          style={{ width: '100%', height: '100%', cursor: 'crosshair', display: 'block', touchAction: 'none' }}
        />
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: '5px 10px', fontSize: 10, letterSpacing: '0.12em',
  background: 'transparent', border: '1px solid var(--border)',
  color: 'var(--text-secondary)', borderRadius: 3, cursor: 'pointer',
  fontFamily: 'inherit', textTransform: 'uppercase',
};
const dangerBtn: React.CSSProperties = {
  padding: '5px 10px', fontSize: 10, letterSpacing: '0.12em',
  background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.4)',
  color: '#ff8888', borderRadius: 3, cursor: 'pointer',
  fontFamily: 'inherit', textTransform: 'uppercase',
};
const primaryBtn: React.CSSProperties = {
  marginLeft: 'auto', padding: '6px 14px', fontSize: 11, letterSpacing: '0.14em',
  background: 'rgba(178,102,255,0.18)', border: '1px solid #b266ff',
  color: '#b266ff', borderRadius: 4, cursor: 'pointer',
  fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
};
