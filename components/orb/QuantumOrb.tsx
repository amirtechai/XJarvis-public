'use client';
/**
 * Quantum Globe Orb — yeni nesil XJarvis HUD.
 *
 * Katmanlar (içten dışa):
 *  1. Rotating wireframe globe (latitude/longitude grid)
 *  2. Node graph — globe yüzeyinde rastgele "şehirler" + aralarında
 *     dinamik pulsing arc'lar (Jarvis Island'dan ilham)
 *  3. Quantum particle cloud — yörüngede uçuşan parçacıklar (3 katman)
 *  4. Voice waveform ring — anlık amplitüde reaktif radyal bar grafiği
 *  5. Speaking ripples — TTS sırasında dış halka dalgalanır
 *  6. State-aware color palette — IDLE/LISTENING/SPEAKING/VISION
 */
import { useEffect, useMemo, useRef } from 'react';

type OrbState = 'IDLE' | 'LISTENING' | 'SPEAKING' | 'VISION_ACTIVE';

interface Props {
  state: OrbState;
  amplitude: number; // 0..1 voice amplitude for waveform
  size?: number;
}

const PALETTE: Record<OrbState, { core: string; glow: string; arc: string; node: string }> = {
  IDLE:          { core: '#4dd0e1', glow: '#00bcd4', arc: '#80deea', node: '#ffffff' },
  LISTENING:     { core: '#00e5ff', glow: '#00b8d4', arc: '#84ffff', node: '#ffffff' },
  SPEAKING:      { core: '#ffb347', glow: '#ff9100', arc: '#ffcc80', node: '#fff8e1' },
  VISION_ACTIVE: { core: '#00ff88', glow: '#00c853', arc: '#69f0ae', node: '#ffffff' },
};

// Stable random globe nodes (lat,lng pairs) — represent "cities"
const NODES = (() => {
  const seed = 31337;
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  return Array.from({ length: 22 }).map(() => ({
    lat: (rnd() - 0.5) * Math.PI,        // -π/2 .. π/2
    lng: rnd() * 2 * Math.PI,            // 0 .. 2π
    pulse: rnd() * Math.PI * 2,          // initial phase
  }));
})();

// Node connection pairs — pre-computed for stable arcs
const ARCS = (() => {
  const seed = 42;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const arcs: Array<[number, number]> = [];
  for (let i = 0; i < 14; i++) {
    const a = Math.floor(rnd() * NODES.length);
    let b = Math.floor(rnd() * NODES.length);
    if (b === a) b = (b + 1) % NODES.length;
    arcs.push([a, b]);
  }
  return arcs;
})();

export function QuantumOrb({ state, amplitude, size = 320 }: Props) {
  const colors = PALETTE[state];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef(0);
  const ampRef = useRef(amplitude);
  const stateRef = useRef(state);

  useEffect(() => { ampRef.current = amplitude; }, [amplitude]);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Bar count for waveform ring
  const BAR_COUNT = 96;
  const barPhases = useMemo(() => {
    return Array.from({ length: BAR_COUNT }).map((_, i) => Math.sin(i * 0.31) * 0.5 + 0.5);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const draw = () => {
      const w = canvas.width = size * dpr;
      const h = canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      if (document.hidden) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const cx = size / 2, cy = size / 2;
      const R_GLOBE = size * 0.30;
      const R_NODES = size * 0.34;
      const R_BARS_INNER = size * 0.40;
      const R_BARS_OUTER = size * 0.46;
      const R_PARTICLES = size * 0.48;

      const t = tRef.current;
      const amp = ampRef.current;
      const st = stateRef.current;
      const c = PALETTE[st];

      // ================== 1. AURA HALO ==================
      const auraR = size * 0.49;
      const auraGrad = ctx.createRadialGradient(cx, cy, R_GLOBE, cx, cy, auraR);
      auraGrad.addColorStop(0, hexToRgba(c.glow, 0.15));
      auraGrad.addColorStop(0.7, hexToRgba(c.glow, 0.04));
      auraGrad.addColorStop(1, hexToRgba(c.glow, 0));
      ctx.fillStyle = auraGrad;
      ctx.beginPath(); ctx.arc(cx, cy, auraR, 0, Math.PI * 2); ctx.fill();

      // ================== 2. ROTATING GLOBE ==================
      const rotY = t * 0.0006;        // around vertical axis (CCW slow)
      const rotX = Math.sin(t * 0.0002) * 0.15; // gentle wobble

      ctx.save();
      ctx.translate(cx, cy);

      // Latitude lines (parallels)
      ctx.lineWidth = 0.6;
      for (let lat = -75; lat <= 75; lat += 15) {
        const phi = (lat * Math.PI) / 180;
        const ry = Math.cos(phi) * R_GLOBE;
        const yc = -Math.sin(phi) * R_GLOBE * Math.cos(rotX) + 0;
        const opacity = 0.20 + 0.15 * Math.cos(phi);
        ctx.strokeStyle = hexToRgba(c.arc, opacity);
        ctx.beginPath();
        ctx.ellipse(0, yc, ry, ry * Math.abs(Math.sin(rotX)) + 1, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Longitude lines (meridians)
      for (let i = 0; i < 12; i++) {
        const lng = (i / 12) * Math.PI * 2 + rotY;
        const visible = Math.sin(lng) > -0.3; // only front-ish
        if (!visible) continue;
        const ellipseRx = Math.abs(Math.cos(lng)) * R_GLOBE;
        const opacity = 0.28 * Math.abs(Math.cos(lng));
        ctx.strokeStyle = hexToRgba(c.arc, opacity);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.ellipse(0, 0, ellipseRx, R_GLOBE, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Equator (highlighted)
      ctx.strokeStyle = hexToRgba(c.core, 0.45);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(0, 0, R_GLOBE, R_GLOBE * Math.abs(Math.sin(rotX)) + 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();

      // ================== 3. NODE POSITIONS (3D → 2D project) ==================
      const projected = NODES.map((n) => {
        const lng = n.lng + rotY;
        const x3 = Math.cos(n.lat) * Math.sin(lng);
        const y3 = Math.sin(n.lat) * Math.cos(rotX) + Math.cos(n.lat) * Math.cos(lng) * Math.sin(rotX);
        const z3 = Math.cos(n.lat) * Math.cos(lng) * Math.cos(rotX) - Math.sin(n.lat) * Math.sin(rotX);
        return {
          x: x3 * R_NODES,
          y: -y3 * R_NODES,
          z: z3,                       // -1..1, +1 = front
          phase: n.pulse,
        };
      });

      // ================== 4. ARCS BETWEEN NODES ==================
      ctx.lineWidth = 0.9;
      for (const [a, b] of ARCS) {
        const pa = projected[a];
        const pb = projected[b];
        // Only draw if both have decent visibility
        const vis = Math.min((pa.z + 1) / 2, (pb.z + 1) / 2);
        if (vis < 0.25) continue;
        // Pulsing brightness
        const pulse = 0.4 + 0.5 * Math.sin(t * 0.003 + a + b);
        const op = vis * pulse * 0.7;
        ctx.strokeStyle = hexToRgba(c.arc, op);
        // Curved arc above globe surface (control point lifted)
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        const lift = dist * 0.4;
        const dirLen = Math.hypot(mx, my) || 1;
        const cpx = mx + (mx / dirLen) * lift;
        const cpy = my + (my / dirLen) * lift;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.quadraticCurveTo(cpx, cpy, pb.x, pb.y);
        ctx.stroke();
      }

      // ================== 5. NODES (parlayan noktalar) ==================
      for (const p of projected) {
        const vis = (p.z + 1) / 2;
        if (vis < 0.1) continue;
        const pulse = 0.6 + 0.4 * Math.sin(t * 0.004 + p.phase);
        const r = (1.6 + 1.4 * vis) * pulse;
        const op = vis * pulse;
        // Glow
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
        g.addColorStop(0, hexToRgba(c.node, op));
        g.addColorStop(0.4, hexToRgba(c.core, op * 0.4));
        g.addColorStop(1, hexToRgba(c.core, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2); ctx.fill();
        // Core dot
        ctx.fillStyle = hexToRgba(c.node, op);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      }

      ctx.restore();

      // ================== 6. CENTER CORE ==================
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R_GLOBE * 0.8);
      coreGrad.addColorStop(0, hexToRgba('#ffffff', 0.85));
      coreGrad.addColorStop(0.18, hexToRgba(c.core, 0.6));
      coreGrad.addColorStop(0.5, hexToRgba(c.core, 0.18));
      coreGrad.addColorStop(1, hexToRgba(c.core, 0));
      ctx.fillStyle = coreGrad;
      ctx.beginPath(); ctx.arc(cx, cy, R_GLOBE * 0.8, 0, Math.PI * 2); ctx.fill();

      // ================== 7. VOICE WAVEFORM RING (radyal barlar) ==================
      ctx.save();
      ctx.translate(cx, cy);
      const ampMix = st === 'LISTENING' || st === 'SPEAKING' ? amp : 0;
      for (let i = 0; i < BAR_COUNT; i++) {
        const a = (i / BAR_COUNT) * Math.PI * 2;
        // Bar height: state-driven base + amplitude burst + per-bar phase
        const base = 0.05 + 0.04 * Math.sin(t * 0.005 + i * 0.4);
        const burst = ampMix * (0.25 + 0.55 * barPhases[i] * Math.sin(t * 0.015 + i * 0.7));
        const speakPulse = st === 'SPEAKING' ? 0.18 * Math.abs(Math.sin(t * 0.008 + i * 0.5)) : 0;
        const len = (R_BARS_OUTER - R_BARS_INNER) * (base + burst + speakPulse);
        const r1 = R_BARS_INNER;
        const r2 = R_BARS_INNER + len;
        const x1 = Math.cos(a) * r1, y1 = Math.sin(a) * r1;
        const x2 = Math.cos(a) * r2, y2 = Math.sin(a) * r2;
        const op = 0.45 + 0.5 * (base + burst);
        ctx.strokeStyle = hexToRgba(c.core, Math.min(0.95, op));
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.restore();

      // ================== 8. QUANTUM PARTICLE CLOUD ==================
      // 3 yörünge katmanı, farklı hız ve yönde
      const layers = [
        { count: 28, r: R_PARTICLES * 0.92, speed: 0.0007,  size: 1.4, op: 0.65, dir: 1 },
        { count: 18, r: R_PARTICLES * 0.84, speed: -0.0011, size: 1.0, op: 0.45, dir: -1 },
        { count: 14, r: R_PARTICLES * 1.01, speed: 0.0005,  size: 0.8, op: 0.35, dir: 1 },
      ];
      for (const layer of layers) {
        for (let i = 0; i < layer.count; i++) {
          const a = (i / layer.count) * Math.PI * 2 + t * layer.speed;
          // Quantum jitter — small radial wobble
          const rJit = layer.r + Math.sin(t * 0.003 + i * 1.7) * 4;
          const x = cx + Math.cos(a) * rJit;
          const y = cy + Math.sin(a) * rJit;
          const twinkle = 0.5 + 0.5 * Math.sin(t * 0.004 + i * 2.3);
          const op = layer.op * twinkle;
          ctx.fillStyle = hexToRgba(c.core, op);
          ctx.beginPath(); ctx.arc(x, y, layer.size, 0, Math.PI * 2); ctx.fill();
        }
      }

      // ================== 9. SPEAKING RIPPLES ==================
      if (st === 'SPEAKING') {
        for (let i = 0; i < 3; i++) {
          const phase = (t * 0.0013 + i * 0.33) % 1;
          const r = R_GLOBE + phase * (R_PARTICLES - R_GLOBE) * 1.5;
          const op = (1 - phase) * 0.45;
          ctx.strokeStyle = hexToRgba(c.core, op);
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // ================== 10. CORE WHITE HOTSPOT ==================
      const corePulse = 0.78 + 0.18 * Math.sin(t * 0.003);
      ctx.fillStyle = hexToRgba('#ffffff', corePulse);
      ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fill();

      tRef.current = t + 16;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [size, barPhases]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: size, height: size,
        display: 'block',
        filter: `drop-shadow(0 0 24px ${hexToRgba(colors.glow, 0.5)})`,
      }}
    />
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
