'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';
import { Jarvis3DOrb } from './Jarvis3DOrb';
import { QuantumOrb } from './QuantumOrb';
import { VideoRobot } from '@/components/VideoRobot';

// SpeechRecognition (webkit prefixed in Tauri/Chromium)
type SR = {
  start: () => void; stop: () => void; abort: () => void;
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
};

type OrbState = 'IDLE' | 'LISTENING' | 'SPEAKING' | 'VISION_ACTIVE';
type Action =
  | { type: 'WAKE' }
  | { type: 'SPEAK_START' }
  | { type: 'SPEAK_END' }
  | { type: 'VISION_ON' }
  | { type: 'VISION_OFF' }
  | { type: 'IDLE' };

function reducer(state: OrbState, action: Action): OrbState {
  switch (action.type) {
    case 'WAKE':
      return state === 'VISION_ACTIVE' ? state : 'LISTENING';
    case 'SPEAK_START':
      return state === 'VISION_ACTIVE' ? state : 'SPEAKING';
    case 'SPEAK_END':
    case 'IDLE':
      return state === 'VISION_ACTIVE' ? state : 'IDLE';
    case 'VISION_ON':
      return 'VISION_ACTIVE';
    case 'VISION_OFF':
      return 'IDLE';
    default:
      return state;
  }
}

const COLOR: Record<OrbState, string> = {
  IDLE: '#00e5ff',
  LISTENING: '#00e5ff',
  SPEAKING: '#ffb347',
  VISION_ACTIVE: '#00ff88',
};

interface JarvisOrbProps {
  size?: number;
}

type OrbStyle = 'quantum' | 'svg' | '3d';

export function JarvisOrb({ size = 320 }: JarvisOrbProps) {
  const [state, dispatch] = useReducer(reducer, 'IDLE');
  const [orbStyle, setOrbStyle] = useState<OrbStyle>('quantum');
  const [use3D, setUse3D] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [pttTranscript, setPttTranscript] = useState('');
  const [pttSupported, setPttSupported] = useState(false);
  const recRef = useRef<SR | null>(null);
  const finalRef = useRef('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setUse3D(localStorage.getItem('xjarvis:orb3d') === '1');
    const savedStyle = localStorage.getItem('xjarvis:orbStyle') as OrbStyle | null;
    if (savedStyle === 'quantum' || savedStyle === 'svg' || savedStyle === '3d') setOrbStyle(savedStyle);
    // PTT artık backend /ptt endpoint'leri + Groq STT ile (tarayıcı
    // SpeechRecognition Tauri webview'de çalışmıyordu). Her zaman destekli.
    setPttSupported(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem('xjarvis:orbStyle', orbStyle); } catch { /* noop */ }
  }, [orbStyle]);
  const amplitudeRef = useRef(1);
  const orbRef = useRef<SVGSVGElement | null>(null);

  // Orb'u basılı tut → backend /ptt/start (mic kaydı). Bırak → /ptt/stop
  // (backend Groq STT yapıp komutu agent'a kendisi gönderir). Option+A ile
  // birebir aynı yol — güvenilir, tarayıcı SpeechRecognition'a bağlı değil.
  const PTT_BASE = 'http://localhost:8766';
  const startPTT = useCallback(() => {
    if (pttActive) return;
    finalRef.current = '';
    setPttActive(true);
    setPttTranscript('');
    dispatch({ type: 'WAKE' });
    fetch(`${PTT_BASE}/ptt/start`, { method: 'POST' }).catch(() => {});
  }, [pttActive]);

  const stopPTT = useCallback((cancel = false) => {
    if (!pttActive) return;
    setPttActive(false);
    setPttTranscript('');
    recRef.current = null;
    dispatch({ type: 'IDLE' });
    void cancel;
    // Backend her durumda kaydı kapatır; transkript + agent gönderimi orada.
    fetch(`${PTT_BASE}/ptt/stop`, { method: 'POST' }).catch(() => {});
  }, [pttActive]);

  // Spacebar PTT (when not typing in input)
  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isTyping(e.target) && !pttActive) {
        e.preventDefault();
        startPTT();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && pttActive && !isTyping(e.target)) {
        e.preventDefault();
        stopPTT(false);
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [pttActive, startPTT, stopPTT]);

  const { lastEvent } = useJarvisEvents([
    EVENT_TYPES.WAKE_WORD_DETECTED,
    EVENT_TYPES.LISTENING_START,
    EVENT_TYPES.LISTENING_STOP,
    EVENT_TYPES.RESPONSE_START,
    EVENT_TYPES.RESPONSE_END,
    EVENT_TYPES.VOICE_AMPLITUDE,
    EVENT_TYPES.VISION_TRIGGERED,
    EVENT_TYPES.VISION_RESULT,
  ]);

  useEffect(() => {
    if (!lastEvent) return;
    switch (lastEvent.event) {
      case EVENT_TYPES.WAKE_WORD_DETECTED:
      case EVENT_TYPES.LISTENING_START:
        dispatch({ type: 'WAKE' });
        break;
      case EVENT_TYPES.LISTENING_STOP:
        dispatch({ type: 'IDLE' });
        break;
      case EVENT_TYPES.RESPONSE_START:
        dispatch({ type: 'SPEAK_START' });
        break;
      case EVENT_TYPES.RESPONSE_END:
        dispatch({ type: 'SPEAK_END' });
        break;
      case EVENT_TYPES.VISION_TRIGGERED:
        dispatch({ type: 'VISION_ON' });
        break;
      case EVENT_TYPES.VOICE_AMPLITUDE: {
        const a = (lastEvent.payload as { amplitude?: number }).amplitude ?? 0;
        amplitudeRef.current = 1 + Math.min(0.25, a * 0.25);
        break;
      }
    }
  }, [lastEvent]);

  // Drive the orb scale via rAF so amplitude updates don't trigger React re-renders.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (orbRef.current) {
        const target = state === 'LISTENING' ? amplitudeRef.current : 1;
        orbRef.current.style.transform = `scale(${target})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const color = COLOR[state];
  const isVision = state === 'VISION_ACTIVE';

  // Quantum orb (default — yeni nesil)
  if (orbStyle === 'quantum' && !use3D) {
    const sizePx = isVision ? Math.round(size * 0.6) : size;
    return (
      <motion.div
        layout
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        style={{
          position: isVision ? 'fixed' : 'relative',
          right: isVision ? '2vw' : 'auto',
          bottom: isVision ? '2vw' : 'auto',
          width: sizePx, height: sizePx,
          zIndex: 10,
          pointerEvents: pttSupported && !isVision ? 'auto' : 'none',
          cursor: pttSupported && !isVision ? (pttActive ? 'grabbing' : 'pointer') : 'default',
          userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
        }}
        onPointerDown={(e) => { if (!pttSupported || isVision) return; e.currentTarget.setPointerCapture(e.pointerId); startPTT(); }}
        onPointerUp={() => { if (pttActive) stopPTT(false); }}
        onPointerCancel={() => { if (pttActive) stopPTT(true); }}
        title={pttSupported ? 'Hold to talk — release to send (Space also works)' : ''}
      >
        <QuantumOrb state={state} amplitude={Math.min(1, (amplitudeRef.current - 1) * 4)} size={sizePx} />
        {pttActive && !isVision && <PttOverlay transcript={pttTranscript} />}
      </motion.div>
    );
  }

  if (use3D) {
    // 3D mod artık Kling AI ile üretilmiş gerçek mimikli robot videosu (hibrit).
    const robotSize = isVision ? Math.round(size * 1.2) : Math.round(size * 1.9);
    return (
      <motion.div
        layout
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        style={{
          position: isVision ? 'fixed' : 'relative',
          right: isVision ? '2vw' : 'auto',
          bottom: isVision ? '2vw' : 'auto',
          zIndex: 10,
          pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <VideoRobot size={robotSize} />
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      style={{
        position: isVision ? 'fixed' : 'relative',
        right: isVision ? '2vw' : 'auto',
        bottom: isVision ? '2vw' : 'auto',
        width: isVision ? '18vw' : size,
        height: isVision ? '18vw' : size,
        zIndex: 10,
        pointerEvents: pttSupported && !isVision ? 'auto' : 'none',
        cursor: pttSupported && !isVision ? (pttActive ? 'grabbing' : 'pointer') : 'default',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none',
      }}
      onPointerDown={(e) => { if (!pttSupported || isVision) return; e.currentTarget.setPointerCapture(e.pointerId); startPTT(); }}
      onPointerUp={() => { if (pttActive) stopPTT(false); }}
      onPointerCancel={() => { if (pttActive) stopPTT(true); }}
      title={pttSupported ? 'Basılı tut konuş — bırakınca gönder (Space tuşu da çalışır)' : ''}
    >
      <svg
        ref={orbRef}
        viewBox="0 0 200 200"
        width="100%"
        height="100%"
        style={{ transition: 'transform 80ms linear', willChange: 'transform', overflow: 'visible' }}
      >
        <defs>
          {/* Core radial gradient — koyu mavi-cyan'dan dışa fade */}
          <radialGradient id="orb-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="20%" stopColor={color}   stopOpacity="0.85" />
            <stop offset="55%" stopColor={color}   stopOpacity="0.35" />
            <stop offset="100%" stopColor={color}  stopOpacity="0" />
          </radialGradient>
          <radialGradient id="orb-aura" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor={color} stopOpacity="0.0" />
            <stop offset="60%" stopColor={color} stopOpacity="0.08" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.0" />
            <stop offset="50%"  stopColor={color} stopOpacity="1.0" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
          <filter id="orb-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* 0. Halo aura (en dış) */}
        <circle cx="100" cy="100" r="98" fill="url(#orb-aura)" />

        {/* 1. Dış halka — 60 tick işaretli (radar/pusula görünümü) */}
        <g style={{ animation: 'hud-spin-slow 60s linear infinite', transformOrigin: '100px 100px' }}>
          {Array.from({ length: 60 }).map((_, i) => {
            const isMajor = i % 5 === 0;
            const angle = (i * 6) * Math.PI / 180;
            const r1 = isMajor ? 86 : 89;
            const r2 = 92;
            const x1 = 100 + r1 * Math.cos(angle), y1 = 100 + r1 * Math.sin(angle);
            const x2 = 100 + r2 * Math.cos(angle), y2 = 100 + r2 * Math.sin(angle);
            return (
              <line key={i}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color} strokeOpacity={isMajor ? 0.7 : 0.25}
                strokeWidth={isMajor ? 1.4 : 0.8}
              />
            );
          })}
        </g>

        {/* 2. Cardinal işaretleri (N/E/S/W) — küçük üçgenler */}
        {[0, 90, 180, 270].map((deg, i) => {
          const a = deg * Math.PI / 180;
          const x = 100 + 95 * Math.cos(a - Math.PI / 2);
          const y = 100 + 95 * Math.sin(a - Math.PI / 2);
          return (
            <polygon key={i}
              points={`${x},${y} ${x - 3},${y + 6} ${x + 3},${y + 6}`}
              fill={color} opacity={state === 'LISTENING' ? 0.95 : 0.5}
              transform={`rotate(${deg} ${x} ${y})`}
              style={{
                animation: state === 'LISTENING'
                  ? `cardinalBlink 1.6s ease-in-out ${i * 0.4}s infinite` : 'none',
              }}
            />
          );
        })}

        {/* 3. Outer ring CW — kalın dashed */}
        <g style={{ animation: 'hud-spin-slow 24s linear infinite', transformOrigin: '100px 100px' }}>
          <circle cx="100" cy="100" r="80"
            fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="1.2"
            strokeDasharray="14 6 2 6"
            filter="url(#orb-glow)"
          />
        </g>

        {/* 4. Mid ring CCW — segmentli arc'lar */}
        <g style={{ animation: 'hud-spin-rev 14s linear infinite', transformOrigin: '100px 100px' }}>
          {Array.from({ length: 8 }).map((_, i) => {
            const a1 = (i * 45 + 4) * Math.PI / 180;
            const a2 = (i * 45 + 38) * Math.PI / 180;
            const r = 68;
            const x1 = 100 + r * Math.cos(a1), y1 = 100 + r * Math.sin(a1);
            const x2 = 100 + r * Math.cos(a2), y2 = 100 + r * Math.sin(a2);
            return (
              <path key={i}
                d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
                fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="1.2"
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* 5. Inner hex frame — pulsing */}
        <g className="hud-pulse" style={{ transformOrigin: '100px 100px' }}>
          <polygon
            points={Array.from({ length: 6 }).map((_, i) => {
              const a = (i * 60 - 90) * Math.PI / 180;
              return `${100 + 50 * Math.cos(a)},${100 + 50 * Math.sin(a)}`;
            }).join(' ')}
            fill="none" stroke={color} strokeOpacity="0.85" strokeWidth="1"
            filter="url(#orb-glow)"
          />
        </g>

        {/* 6. Arc reactor — Stark'ın üçgen pattern'i */}
        <g style={{ animation: 'hud-spin-rev 28s linear infinite', transformOrigin: '100px 100px' }}>
          {Array.from({ length: 3 }).map((_, i) => {
            const rot = i * 120;
            const a = (rot - 90) * Math.PI / 180;
            const x1 = 100 + 38 * Math.cos(a);
            const y1 = 100 + 38 * Math.sin(a);
            const a2 = (rot + 30) * Math.PI / 180;
            const x2 = 100 + 38 * Math.cos(a2);
            const y2 = 100 + 38 * Math.sin(a2);
            return (
              <line key={i}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color} strokeOpacity="0.85" strokeWidth="1.4"
                filter="url(#orb-glow)"
              />
            );
          })}
        </g>

        {/* 7. Center core — beyaz hot spot + radial fade */}
        <circle cx="100" cy="100" r="36" fill="url(#orb-core)" />
        <circle cx="100" cy="100" r="6"  fill="#ffffff" opacity="0.95" filter="url(#orb-glow)">
          <animate attributeName="opacity" values="0.95;0.65;0.95" dur="2.4s" repeatCount="indefinite" />
        </circle>

        {/* 8. Orbiting particles — 3 farklı yörünge */}
        <g style={{ animation: 'hud-spin-slow 18s linear infinite', transformOrigin: '100px 100px' }}>
          {[0, 72, 144, 216, 288].map((deg) => {
            const a = (deg - 90) * Math.PI / 180;
            return <circle key={deg} cx={100 + 75 * Math.cos(a)} cy={100 + 75 * Math.sin(a)} r="1.6" fill={color} />;
          })}
        </g>
        <g style={{ animation: 'hud-spin-rev 26s linear infinite', transformOrigin: '100px 100px' }}>
          {[0, 90, 180, 270].map((deg) => {
            const a = (deg - 90) * Math.PI / 180;
            return <circle key={deg} cx={100 + 60 * Math.cos(a)} cy={100 + 60 * Math.sin(a)} r="1.2" fill={color} opacity="0.7" />;
          })}
        </g>
        <g style={{ animation: 'hud-spin-slow 40s linear infinite', transformOrigin: '100px 100px' }}>
          {[15, 105, 195, 285].map((deg) => {
            const a = (deg - 90) * Math.PI / 180;
            return <circle key={deg} cx={100 + 88 * Math.cos(a)} cy={100 + 88 * Math.sin(a)} r="0.9" fill={color} opacity="0.6" />;
          })}
        </g>

        {/* 9. Speaking ripples (3-stage staggered) */}
        {state === 'SPEAKING' && (
          <>
            {[0, 0.5, 1.0].map((delay, i) => (
              <circle key={i} cx="100" cy="100" r="50" fill="none" stroke={color} strokeWidth="1.5">
                <animate attributeName="r" from="50" to="98" dur="1.5s" begin={`${delay}s`} repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" from="0.7" to="0" dur="1.5s" begin={`${delay}s`} repeatCount="indefinite" />
              </circle>
            ))}
          </>
        )}

        {/* 10. Listening — inner core breathing scale */}
        {state === 'LISTENING' && (
          <circle cx="100" cy="100" r="44" fill="none" stroke={color} strokeWidth="0.8" strokeOpacity="0.5">
            <animate attributeName="r" values="40;48;40" dur="2s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.4;0.8;0.4" dur="2s" repeatCount="indefinite" />
          </circle>
        )}

        <style>{`
          @keyframes cardinalBlink {
            0%, 100% { opacity: 0.4; }
            50%      { opacity: 1.0; }
          }
        `}</style>
      </svg>

      {pttActive && !isVision && (
        <>
          <div
            className="hud-font"
            style={{
              position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
              padding: '4px 12px', borderRadius: 999,
              background: 'rgba(255,40,80,0.18)',
              border: '1px solid rgba(255,80,120,0.7)',
              color: '#ff6688', fontSize: 10, letterSpacing: '0.2em', fontWeight: 700,
              boxShadow: '0 0 16px rgba(255,80,120,0.4)',
              pointerEvents: 'none', zIndex: 20,
            }}
          >
            ● REC · BIRAKINCA GÖNDER
          </div>
          {pttTranscript && (
            <div style={{
              position: 'absolute', bottom: -28, left: '50%', transform: 'translateX(-50%)',
              padding: '4px 10px', maxWidth: '90%',
              background: 'rgba(0,8,20,0.85)',
              border: '1px solid rgba(var(--hud-rgb),0.4)',
              borderRadius: 4, color: 'var(--hud-cyan)', fontSize: 11,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              pointerEvents: 'none', zIndex: 20,
            }}>
              {pttTranscript}
            </div>
          )}
        </>
      )}
      {isVision && (
        <div
          className="hud-font"
          style={{
            position: 'absolute',
            bottom: '-1.5em',
            left: 0,
            right: 0,
            textAlign: 'center',
            color: 'var(--hud-emerald)',
            fontSize: '0.7rem',
            letterSpacing: '0.2em',
          }}
        >
          VISION ACTIVE
        </div>
      )}
    </motion.div>
  );
}

function PttOverlay({ transcript }: { transcript: string }) {
  return (
    <>
      <div
        className="hud-font"
        style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          padding: '4px 12px', borderRadius: 999,
          background: 'rgba(255,40,80,0.18)', border: '1px solid rgba(255,80,120,0.7)',
          color: '#ff6688', fontSize: 10, letterSpacing: '0.2em', fontWeight: 700,
          boxShadow: '0 0 16px rgba(255,80,120,0.4)',
          pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap',
        }}
      >● REC · RELEASE TO SEND</div>
      {transcript && (
        <div style={{
          position: 'absolute', bottom: -28, left: '50%', transform: 'translateX(-50%)',
          padding: '4px 10px', maxWidth: '90%',
          background: 'rgba(0,8,20,0.85)', border: '1px solid rgba(var(--hud-rgb),0.4)',
          borderRadius: 4, color: 'var(--hud-cyan)', fontSize: 11,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          pointerEvents: 'none', zIndex: 20,
        }}>{transcript}</div>
      )}
    </>
  );
}

export function OrbStyleSwitcher() {
  const [style, setStyle] = useState<OrbStyle>('quantum');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const s = localStorage.getItem('xjarvis:orbStyle') as OrbStyle | null;
    if (s === 'quantum' || s === 'svg' || s === '3d') setStyle(s);
  }, []);
  const set = (s: OrbStyle) => {
    setStyle(s);
    try {
      localStorage.setItem('xjarvis:orbStyle', s);
      localStorage.setItem('xjarvis:orb3d', s === '3d' ? '1' : '0');
      window.location.reload();
    } catch { /* noop */ }
  };
  const styles: Array<{ id: OrbStyle; label: string }> = [
    { id: 'quantum', label: 'Quantum' },
    { id: 'svg', label: 'Classic' },
    { id: '3d', label: '3D' },
  ];
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 4,
      background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(var(--hud-rgb),0.25)' }}>
      {styles.map((s) => (
        <button
          key={s.id} onClick={() => set(s.id)}
          style={{
            padding: '3px 9px', fontSize: 9, letterSpacing: '0.14em', fontWeight: 700,
            background: style === s.id ? 'rgba(var(--hud-rgb),0.28)' : 'transparent',
            border: 'none', borderRadius: 3,
            color: style === s.id ? '#00d4ff' : 'rgba(255,255,255,0.5)',
            cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
          }}
        >{s.label}</button>
      ))}
    </div>
  );
}
