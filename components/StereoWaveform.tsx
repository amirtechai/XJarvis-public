'use client';
import { useEffect, useRef } from 'react';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';

/**
 * Orb'un sağına/soluna konan ince spektrum çubukları.
 * - Sol kanal: kullanıcı mikrofon amplitudu (VOICE_AMPLITUDE)
 * - Sağ kanal: TTS playback aktifken pseudo-spectrum animasyonu
 *
 * Çok yer kaplamaması için BAR_COUNT=14 ve genişlik 18px tutuluyor.
 * Yüksek = orb yüksekliği kadar (parent height: 100%).
 */

const BAR_COUNT = 14;
const DECAY = 0.85;     // her frame'de seviyenin azalma oranı
const GAIN = 1.6;       // mic input gain
const IDLE_NOISE = 0.06;// stand-by'da çok hafif zemin animasyonu

interface Props {
  side: 'left' | 'right';
  height?: number | string;
  width?: number;
}

export function StereoWaveform({ side, height = '60%', width = 18 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levels = useRef<number[]>(Array(BAR_COUNT).fill(0));
  const targetEnergy = useRef<number>(0);     // hedef seviye (mic veya TTS)
  const speakingRef = useRef<boolean>(false);

  const { lastEvent } = useJarvisEvents([
    EVENT_TYPES.VOICE_AMPLITUDE,
    EVENT_TYPES.TTS_PLAYBACK_START,
    EVENT_TYPES.TTS_PLAYBACK_END,
  ]);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.event === EVENT_TYPES.VOICE_AMPLITUDE && side === 'left') {
      const a = Number((lastEvent.payload as { amplitude?: number })?.amplitude ?? 0);
      targetEnergy.current = Math.min(1, a * GAIN);
    } else if (lastEvent.event === EVENT_TYPES.TTS_PLAYBACK_START && side === 'right') {
      speakingRef.current = true;
    } else if (lastEvent.event === EVENT_TYPES.TTS_PLAYBACK_END && side === 'right') {
      speakingRef.current = false;
    }
  }, [lastEvent, side]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.floor(r.width * dpr));
      cv.height = Math.max(1, Math.floor(r.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    let raf = 0;
    const loop = () => {
      const w = cv.width, h = cv.height;
      ctx.clearRect(0, 0, w, h);

      // Hedef enerji — TTS konuşurken sağda 0.6-0.95 dalgalansın
      let energy = targetEnergy.current;
      if (side === 'right' && speakingRef.current) {
        energy = 0.55 + Math.random() * 0.4;
      }
      // Stand-by: çok hafif noise
      if (energy < IDLE_NOISE) energy = IDLE_NOISE * (0.4 + Math.random() * 0.6);

      // Bar seviyelerini güncelle (orta bar en yüksek, kenarlara doğru azalma)
      for (let i = 0; i < BAR_COUNT; i++) {
        const dist = Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
        const fall = 1 - Math.pow(dist, 1.5) * 0.6;
        const target = energy * fall * (0.7 + Math.random() * 0.3);
        levels.current[i] = Math.max(target, levels.current[i] * DECAY);
      }

      // Çiz
      const barH = h / BAR_COUNT;
      const cssRgb = getComputedStyle(document.documentElement).getPropertyValue('--hud-rgb').trim() || '0,229,255';
      for (let i = 0; i < BAR_COUNT; i++) {
        const lvl = levels.current[i];
        const barW = lvl * w * 0.95 + 1;
        const y = i * barH + barH * 0.18;
        const bH = barH * 0.64;
        const x = side === 'left' ? w - barW : 0;
        const alpha = 0.35 + lvl * 0.55;
        const grad = ctx.createLinearGradient(x, 0, x + barW, 0);
        if (side === 'left') {
          grad.addColorStop(0, `rgba(${cssRgb}, ${alpha * 0.2})`);
          grad.addColorStop(1, `rgba(${cssRgb}, ${alpha})`);
        } else {
          grad.addColorStop(0, `rgba(${cssRgb}, ${alpha})`);
          grad.addColorStop(1, `rgba(${cssRgb}, ${alpha * 0.2})`);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, bH);
      }

      // Decay mic input
      targetEnergy.current *= DECAY;

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [side]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block' }}
      aria-hidden
    />
  );
}
