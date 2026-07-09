'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface Node { id: string; label: string; type: string; weight: number }
interface Edge { from: string; to: string; weight: number }

interface SimNode extends Node { x: number; y: number; vx: number; vy: number }

export function KnowledgeClient() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [filter, setFilter] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    fetch(`${BACKEND}/api/knowledge/graph`).then((r) => r.json()).then((j) => {
      setNodes(j.nodes || []);
      setEdges(j.edges || []);
      setDegraded(!!j.degraded);
    }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return { nodes, edges };
    const re = new RegExp(filter, 'i');
    const keep = new Set(nodes.filter((n) => re.test(n.label)).map((n) => n.id));
    // Add neighbors
    for (const e of edges) {
      if (keep.has(e.from)) keep.add(e.to);
      if (keep.has(e.to)) keep.add(e.from);
    }
    return {
      nodes: nodes.filter((n) => keep.has(n.id)),
      edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    };
  }, [filter, nodes, edges]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Force-directed layout
    const sim: SimNode[] = filtered.nodes.map((n) => ({
      ...n,
      x: w / 2 + (Math.random() - 0.5) * w * 0.8,
      y: h / 2 + (Math.random() - 0.5) * h * 0.8,
      vx: 0, vy: 0,
    }));
    const idMap = new Map(sim.map((n) => [n.id, n]));

    const tick = () => {
      // Repulsion
      for (let i = 0; i < sim.length; i++) {
        for (let j = i + 1; j < sim.length; j++) {
          const a = sim[i], b = sim[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          const d2 = Math.max(40, dx * dx + dy * dy);
          const f = 800 / d2;
          const dist = Math.sqrt(d2);
          dx /= dist; dy /= dist;
          a.vx -= dx * f; a.vy -= dy * f;
          b.vx += dx * f; b.vy += dy * f;
        }
      }
      // Edge spring
      for (const e of filtered.edges) {
        const a = idMap.get(e.from), b = idMap.get(e.to);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = 80;
        const f = (dist - target) * 0.02;
        a.vx += (dx / dist) * f; a.vy += (dy / dist) * f;
        b.vx -= (dx / dist) * f; b.vy -= (dy / dist) * f;
      }
      // Center gravity + integrate
      for (const n of sim) {
        n.vx += (w / 2 - n.x) * 0.0005;
        n.vy += (h / 2 - n.y) * 0.0005;
        n.vx *= 0.85; n.vy *= 0.85;
        n.x += n.vx; n.y += n.vy;
      }

      // Render
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 0.6;
      for (const e of filtered.edges) {
        const a = idMap.get(e.from), b = idMap.get(e.to);
        if (!a || !b) continue;
        ctx.strokeStyle = `rgba(0, 212, 255, ${Math.min(0.5, e.weight * 0.15)})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (const n of sim) {
        const r = n.type === 'episode' ? 6 : 3 + Math.min(8, n.weight);
        const c = n.type === 'episode' ? '#ffb347' : '#00d4ff';
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(n.label.slice(0, 24), n.x + r + 3, n.y + 3);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [filtered]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 12, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
        display: 'flex', gap: 12, alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ KNOWLEDGE GRAPH</span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{filtered.nodes.length} nodes · {filtered.edges.length} edges</span>
        <input
          value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          style={{
            marginLeft: 'auto', padding: '5px 10px', fontSize: 11,
            background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', borderRadius: 4, fontFamily: 'inherit',
            minWidth: 200,
          }}
        />
        {degraded && <span style={{ fontSize: 10, color: '#ff8888' }}>⚠ sqlite3 module not installed</span>}
      </div>
      <div style={{
        flex: 1, position: 'relative',
        background: 'radial-gradient(circle at 50% 50%, rgba(0,30,60,0.5) 0%, rgba(0,5,15,0.95) 100%)',
        border: '1px solid rgba(var(--hud-rgb),0.18)', borderRadius: 6,
      }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </div>
  );
}
