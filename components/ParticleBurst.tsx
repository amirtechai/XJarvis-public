'use client';

import { useEffect, useRef, useState } from 'react';
import { useJarvis } from '../providers/JarvisProvider';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; size: number }

export function ParticleBurst() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const { onRawMessage } = useJarvis();
  const [, setTick] = useState(0);

  useEffect(() => {
    return onRawMessage((msg) => {
      const t = msg.type as string;
      if (t === 'stream_chunk' && particles.current.length < 200) {
        spawn(20);
      }
      return false;
    });
  }, [onRawMessage]);

  const spawn = (n: number) => {
    const c = canvasRef.current;
    if (!c) return;
    const cx = c.width / 2;
    const cy = c.height / 2;
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.7 + Math.random() * 1.6;
      particles.current.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        max: 90 + Math.random() * 60,
        hue: 180 + Math.random() * 30,
        size: 0.6 + Math.random() * 1.4,
      });
    }
    setTick((x) => x + 1);
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const ctx = c.getContext('2d')!;

    const loop = () => {
      if (!document.hidden) {
        ctx.clearRect(0, 0, c.width, c.height);
        const arr = particles.current;
        for (let i = arr.length - 1; i >= 0; i--) {
          const p = arr[i];
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.985;
          p.vy *= 0.985;
          p.life += 1;
          const a = Math.max(0, 1 - p.life / p.max);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${a * 0.85})`;
          ctx.shadowColor = `hsl(${p.hue}, 90%, 65%)`;
          ctx.shadowBlur = 6;
          ctx.fill();
          if (p.life > p.max) arr.splice(i, 1);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', inset: 0,
        pointerEvents: 'none',
        zIndex: 50,
        mixBlendMode: 'screen',
      }}
    />
  );
}
