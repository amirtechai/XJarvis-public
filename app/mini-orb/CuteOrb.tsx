'use client';

/**
 * CuteOrb — masaüstü floating asistan için sevimli, canlı, ŞEFFAF dairesel orb.
 *
 * Tasarım DNA "Lumi": parlak inci/damla görünümü — yumuşak iç parıltı, cam-parlak
 * highlight, nefes alan dış hale, durum renkleri + amplitüd-reaktif. HUD/wireframe/
 * wordmark YOK; kare arka plan YOK (pencere transparent → gerçek daire).
 *
 * Tamamen GPU-dostu: yalnız transform/opacity/filter animasyonu → 60fps.
 *
 *  - idle      → yumuşak camgöbeği, yavaş nefes + minik yörünge kıvılcımları
 *  - listening → naneyeşili, hızlı nabız + sonar halkası (bas-konuş)
 *  - handsFree → magenta/mor, kalıcı sonar (eller-serbest, "sürekli dinliyor")
 *  - speaking  → parlak camgöbeği, dışa yayılan dalga halkaları
 *
 * amplitude (0..1): çekirdeği ve haleyi gerçek-zamanlı şişirir.
 */
import { useEffect, useRef } from 'react';

type Props = {
  listening: boolean;
  speaking: boolean;
  handsFree: boolean;
  amplitude: number; // 0..1
};

export function CuteOrb({ listening, speaking, handsFree, amplitude }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // Amplitüdü CSS değişkenine yumuşatarak yaz (re-render yok, 60fps).
  const ampSmooth = useRef(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      ampSmooth.current += (amplitude - ampSmooth.current) * 0.18;
      const el = wrapRef.current;
      if (el) el.style.setProperty('--amp', ampSmooth.current.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [amplitude]);

  const phase = speaking ? 'speaking' : handsFree ? 'handsfree' : listening ? 'listening' : 'idle';

  return (
    <div ref={wrapRef} className="lumi" data-phase={phase}>
      <div className="lumi-glow" />
      <div className="lumi-ring lumi-ring-1" />
      <div className="lumi-ring lumi-ring-2" />
      <div className="lumi-core">
        <div className="lumi-gloss" />
        <div className="lumi-shade" />
      </div>
      <div className="lumi-sparkles">
        <span /><span /><span />
      </div>

      <style>{`
        .lumi {
          --d: 76vmin;
          --amp: 0;
          /* idle (camgöbeği) renk seti */
          --c-hi:   #eaffff;
          --c-mid:  #58d6ff;
          --c-deep: #0c5f88;
          --c-glow: 70,196,255;
          position: absolute; inset: 0; margin: auto;
          width: var(--d); height: var(--d);
          display: grid; place-items: center;
          pointer-events: none;
        }
        .lumi[data-phase="listening"] { --c-hi:#ecfff6; --c-mid:#5cffc0; --c-deep:#0a8a5e; --c-glow:46,255,176; }
        .lumi[data-phase="handsfree"] { --c-hi:#ffeafb; --c-mid:#ff86e4; --c-deep:#7d2191; --c-glow:255,108,210; }
        .lumi[data-phase="speaking"]  { --c-hi:#eafdff; --c-mid:#6ad9ff; --c-deep:#0b6f9c; --c-glow:90,212,255; }

        /* ── dış hale ───────────────────────────────── */
        .lumi-glow {
          position: absolute; width: 120%; height: 120%;
          border-radius: 50%;
          background: radial-gradient(circle at 50% 50%,
            rgba(var(--c-glow), .55) 0%,
            rgba(var(--c-glow), .28) 38%,
            rgba(var(--c-glow), 0) 70%);
          filter: blur(6px);
          transform: scale(calc(.92 + var(--amp) * .35));
          opacity: calc(.7 + var(--amp) * .3);
          animation: lumiBreath 4.2s ease-in-out infinite;
          will-change: transform, opacity;
        }
        .lumi[data-phase="listening"] .lumi-glow,
        .lumi[data-phase="speaking"] .lumi-glow { animation-duration: 1.9s; }
        .lumi[data-phase="handsfree"] .lumi-glow { animation-duration: 2.4s; }

        /* ── çekirdek inci ──────────────────────────── */
        .lumi-core {
          position: absolute; width: 70%; height: 70%;
          border-radius: 50%;
          background:
            radial-gradient(circle at 36% 30%,
              var(--c-hi) 0%,
              var(--c-mid) 34%,
              var(--c-deep) 78%,
              #04202f 100%);
          box-shadow:
            inset 0 0 18px rgba(255,255,255,.28),
            inset -6px -8px 22px rgba(0,0,0,.40),
            0 0 26px rgba(var(--c-glow), .65),
            0 0 60px rgba(var(--c-glow), .35);
          transform: scale(calc(1 + var(--amp) * .12));
          animation: lumiBreath 4.2s ease-in-out infinite;
          will-change: transform;
        }
        .lumi[data-phase="listening"] .lumi-core,
        .lumi[data-phase="speaking"] .lumi-core { animation-duration: 1.9s; }

        /* cam-parlak highlight (sevimlilik) */
        .lumi-gloss {
          position: absolute; top: 12%; left: 18%;
          width: 42%; height: 32%;
          border-radius: 50%;
          background: radial-gradient(circle at 50% 50%,
            rgba(255,255,255,.92) 0%, rgba(255,255,255,.25) 45%, transparent 70%);
          filter: blur(1px);
          transform: rotate(-18deg);
        }
        /* alt gölge (hacim) */
        .lumi-shade {
          position: absolute; bottom: 8%; left: 50%; transform: translateX(-50%);
          width: 64%; height: 26%; border-radius: 50%;
          background: radial-gradient(circle at 50% 100%, rgba(0,0,0,.35), transparent 72%);
        }

        /* ── sonar / dalga halkaları ────────────────── */
        .lumi-ring {
          position: absolute; width: 70%; height: 70%;
          border-radius: 50%;
          border: 1.5px solid rgba(var(--c-glow), .55);
          opacity: 0;
          will-change: transform, opacity;
        }
        .lumi[data-phase="listening"] .lumi-ring,
        .lumi[data-phase="handsfree"] .lumi-ring,
        .lumi[data-phase="speaking"] .lumi-ring {
          animation: lumiPing 2.1s ease-out infinite;
        }
        .lumi[data-phase="listening"] .lumi-ring,
        .lumi[data-phase="speaking"] .lumi-ring { animation-duration: 1.6s; }
        .lumi-ring-2 { animation-delay: .8s !important; }

        /* ── yörünge kıvılcımları (idle sevimlilik) ── */
        .lumi-sparkles { position: absolute; width: 92%; height: 92%; animation: lumiSpin 14s linear infinite; }
        .lumi-sparkles span {
          position: absolute; top: 50%; left: 50%;
          width: 5px; height: 5px; margin: -2.5px;
          border-radius: 50%;
          background: rgba(var(--c-glow), .95);
          box-shadow: 0 0 8px rgba(var(--c-glow), .9);
        }
        .lumi-sparkles span:nth-child(1) { transform: translate(46%, -120%); }
        .lumi-sparkles span:nth-child(2) { transform: translate(150%, 60%) scale(.7); }
        .lumi-sparkles span:nth-child(3) { transform: translate(-150%, 70%) scale(.55); }
        .lumi[data-phase="idle"] .lumi-sparkles { opacity: .85; }
        .lumi:not([data-phase="idle"]) .lumi-sparkles { opacity: 0; transition: opacity .4s; }

        @keyframes lumiBreath {
          0%, 100% { transform: scale(calc(1 + var(--amp) * .12)); }
          50%      { transform: scale(calc(1.045 + var(--amp) * .12)); }
        }
        @keyframes lumiPing {
          0%   { transform: scale(.72); opacity: .0; }
          18%  { opacity: .7; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @keyframes lumiSpin { to { transform: rotate(360deg); } }

        @media (prefers-reduced-motion: reduce) {
          .lumi-glow, .lumi-core, .lumi-ring, .lumi-sparkles { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
