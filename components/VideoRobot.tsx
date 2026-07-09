'use client';
import { BACKEND } from '@/lib/backend';

/**
 * Canlı robot — Kling AI ile fotoğraftan üretilmiş gerçek mimikli video.
 * HİBRİT (madde 7): video gerçekçi mimik/çene/göz hareketini verir; XJarvis
 * konuşurken üstüne vurgu (parlaklık + neon glow + hafif zoom), dinlerken
 * (resme basılı tut → PTT) yeşil nabız çerçeve. Yanlarda animasyonlu neon ışık.
 *
 * NOT: WKWebView (Tauri) <video> HTTP range (206) ister → backend range
 * sunucusundan (:3001/bg/) yüklenir; embedded fallback dev/Chrome için.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';

const VOICE = 'http://localhost:8766';
const BACKEND_SRC = `${BACKEND}/bg/robot-live.mp4`;
const EMBED_SRC = '/robot-live.mp4';

export function VideoRobot({ size = 520 }: { size?: number }) {
  const vidRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState(BACKEND_SRC);
  const [talking, setTalking] = useState(false);
  const [listening, setListening] = useState(false);

  const { lastEvent } = useJarvisEvents([
    EVENT_TYPES.TTS_PLAYBACK_START, EVENT_TYPES.TTS_PLAYBACK_END,
    EVENT_TYPES.RESPONSE_START, EVENT_TYPES.RESPONSE_CHUNK, EVENT_TYPES.RESPONSE_END,
  ]);

  useEffect(() => {
    if (!lastEvent) return;
    const ev = lastEvent.event;
    if (ev === EVENT_TYPES.TTS_PLAYBACK_START || ev === EVENT_TYPES.RESPONSE_START || ev === EVENT_TYPES.RESPONSE_CHUNK) {
      setTalking(true);
    } else if (ev === EVENT_TYPES.TTS_PLAYBACK_END || ev === EVENT_TYPES.RESPONSE_END) {
      setTalking(false);
    }
  }, [lastEvent]);

  // Konuşurken videoyu oynat (hızlı), boştayken yavaş loop (idle his).
  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    v.playbackRate = talking ? 1.0 : 0.65;
  }, [talking]);

  // Backend range yoksa embedded'a düş.
  const onError = useCallback(() => {
    if (src !== EMBED_SRC) setSrc(EMBED_SRC);
  }, [src]);

  const pttDown = useCallback(async (e: React.PointerEvent) => {
    e.preventDefault();
    setListening(true);
    try { await fetch(`${VOICE}/ptt/start`, { method: 'POST' }); } catch { /* noop */ }
  }, []);
  const pttUp = useCallback(async () => {
    setListening(false);
    try { await fetch(`${VOICE}/ptt/stop`, { method: 'POST' }); } catch { /* noop */ }
  }, []);

  const W = size;
  const H = Math.round(size * 1640 / 1264); // video oranı (dikey)

  const accent = listening ? 'rgba(0, 230, 150, 0.9)' : talking ? 'rgba(90, 180, 255, 0.85)' : 'rgba(120, 200, 255, 0.3)';
  const glow = listening ? 70 : talking ? 60 : 36;

  return (
    <div
      onPointerDown={pttDown}
      onPointerUp={pttUp}
      onPointerLeave={pttUp}
      title="Konuşmak için basılı tut"
      style={{
        position: 'relative',
        width: W,
        height: H,
        borderRadius: 18,
        overflow: 'hidden',
        cursor: 'pointer',
        background: '#05080f',
        boxShadow: `0 0 ${glow}px ${accent}, inset 0 0 0 1px ${accent}`,
        transition: 'box-shadow 240ms ease, transform 240ms ease',
        transform: talking ? 'scale(1.012)' : 'scale(1)',
      }}
    >
      <video
        ref={vidRef}
        src={src}
        autoPlay loop muted playsInline
        onError={onError}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', display: 'block',
          // Konuşurken canlanma: parlaklık + doygunluk artışı
          filter: talking ? 'brightness(1.12) saturate(1.15) contrast(1.04)' : 'brightness(1) saturate(1)',
          transition: 'filter 240ms ease',
        }}
      />

      {/* Yan animasyonlu neon ışık huzmeleri (madde 5) */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background:
          'linear-gradient(90deg, rgba(20,110,255,0.22) 0%, transparent 16%, transparent 84%, rgba(150,40,255,0.20) 100%)',
        mixBlendMode: 'screen',
        animation: 'robot-beam 4s ease-in-out infinite',
      }} />
      {/* Üst tarama parıltısı */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'linear-gradient(180deg, rgba(120,180,255,0.16) 0%, transparent 22%)',
        mixBlendMode: 'screen',
      }} />
      {/* Konuşma vurgusu: alt kenar nabız çizgisi */}
      {talking && (
        <div aria-hidden style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 4,
          background: 'linear-gradient(90deg, transparent, #5ab4ff, #9e6bff, transparent)',
          animation: 'robot-pulse 1.1s ease-in-out infinite',
        }} />
      )}

      <style jsx>{`
        @keyframes robot-beam {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
        @keyframes robot-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
