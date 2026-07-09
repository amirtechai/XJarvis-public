'use client';
import { BACKEND } from '@/lib/backend';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Sürekli dönen video arka plan "şovu".
 * - Birden çok ücretsiz stok klibi (Pexels lisansı) sırayla oynatır.
 * - Klipler arasında crossfade (giriş/çıkış) + hafif zoom (ken-burns) hareketi.
 * - z-index -2 → wallpaper.jpg (body::before) fallback'inin üstünde,
 *   okunabilirlik overlay'inin (body::after, z-index -1) altında durur.
 *   Böylece tablolar/paneller (z-index 0+) overlay'in üstünde net kalır.
 *
 * KAYNAK: WKWebView (Tauri) <video> oynatmak için HTTP range (206) ister; gömülü
 * Tauri protokolü range vermediğinden videoları range destekli backend'den
 * (localhost:3001/bg/...) yükleriz. Backend yoksa gömülü /bg/ yoluna düşeriz.
 */

const FILES = [
  'tunnel_particles.mp4',
  'blue_blockchain.mp4',
  'data_flow.mp4',
  'glowing_tunnel.mp4',
  'digital_connection.mp4',
  'hud_interface.mp4',
] as const;

const BG_BASE = `${BACKEND}/bg/`;
const EMBEDDED = '/bg/';

const CROSSFADE_MS = 1400;
// Klip bitmeden bu kadar önce bir sonrakine geçmeye başla (crossfade için overlap).
const CROSSFADE_LEAD_S = 1.6;

type Layer = { file: string; key: number };

export function VideoBackground() {
  // İki katman: biri görünür, biri arkada bir sonrakini hazırlar → çakışmalı geçiş.
  const [layers, setLayers] = useState<[Layer, Layer]>([
    { file: FILES[0], key: 0 },
    { file: FILES[1 % FILES.length], key: 1 },
  ]);
  const [front, setFront] = useState<0 | 1>(0); // hangi katman görünür
  const indexRef = useRef(1); // FILES'ta en son yüklenen klip indeksi
  const transitioningRef = useRef(false);
  const videoRefs = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // İlk görünür klibi açıkça oynat (WKWebView autoplay attribute'unu garantiye al).
  useEffect(() => {
    const v = videoRefs.current[front];
    if (v) v.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = useCallback(() => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;

    const nextIndex = (indexRef.current + 1) % FILES.length;
    indexRef.current = nextIndex;
    const backIdx = front === 0 ? 1 : 0;

    // Arka katmana bir sonraki klibi koy ve oynat.
    setLayers((prev) => {
      const copy: [Layer, Layer] = [prev[0], prev[1]];
      copy[backIdx] = { file: FILES[nextIndex], key: prev[backIdx].key + 2 };
      return copy;
    });

    // DOM güncellenince arka videoyu başlat, sonra katmanları çapraz geçir.
    requestAnimationFrame(() => {
      const backVid = videoRefs.current[backIdx];
      if (backVid) {
        backVid.currentTime = 0;
        backVid.play().catch(() => {});
      }
      setFront(backIdx as 0 | 1);
      window.setTimeout(() => {
        transitioningRef.current = false;
      }, CROSSFADE_MS);
    });
  }, [front]);

  // Görünür klibin sonuna yaklaşınca geçişi tetikle.
  const onTimeUpdate = (which: 0 | 1) => (e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (which !== front) return;
    const v = e.currentTarget;
    if (!v.duration || Number.isNaN(v.duration)) return;
    if (v.currentTime >= v.duration - CROSSFADE_LEAD_S) advance();
  };

  // Backend erişilemezse gömülü yola düş (tek sefer).
  const onError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.src.startsWith(BG_BASE)) {
      const file = v.src.split('/').pop() || '';
      v.src = EMBEDDED + file;
      v.load();
      v.play().catch(() => {});
    }
  };

  // Sekme gizliyken duraklat (CPU/pil tasarrufu).
  useEffect(() => {
    const onVis = () => {
      const v = videoRefs.current[front];
      if (!v) return;
      if (document.hidden) v.pause();
      else v.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [front]);

  return (
    <div aria-hidden className="jarvis-video-bg">
      {layers.map((layer, i) => (
        <video
          key={layer.key}
          ref={(el) => {
            videoRefs.current[i] = el;
          }}
          className={`jarvis-video-bg__layer${front === i ? ' is-front' : ''}${
            reduceMotion ? ' no-motion' : ''
          }`}
          src={BG_BASE + layer.file}
          autoPlay
          muted
          loop={false}
          playsInline
          onTimeUpdate={onTimeUpdate(i as 0 | 1)}
          onError={onError}
          onEnded={() => {
            if ((i as 0 | 1) === front) advance();
          }}
          preload="auto"
        />
      ))}
    </div>
  );
}
