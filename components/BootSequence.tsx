'use client';
import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';
const SESSION_KEY = 'xjarvis:boot:done';

interface Line { label: string; status: 'pending' | 'ok' | 'fail'; detail?: string }

const DIAGNOSTIC_LINES = [
  '> initializing arc reactor...',
  '> calibrating voice subsystem · whisper.base · deepgram nova-3',
  '> loading agent runtime · 166 tools · claude-haiku-4.5',
  '> establishing bus connection · ws://localhost:3001',
  '> integrations: gmail · calendar · github · whatsapp',
  '> tts engine: elevenlabs · george voice id confirmed',
  '> wake word: jarvis (whisper) · snap detector active',
  '> all subsystems nominal',
];

export function BootSequence() {
  const [done, setDone] = useState<boolean>(true);
  const [phase, setPhase] = useState<'reactor' | 'subsystems' | 'diagnostic' | 'ready'>('reactor');
  const [lines, setLines] = useState<Line[]>([
    { label: 'BACKEND',  status: 'pending' },
    { label: 'VOICE',    status: 'pending' },
    { label: 'VISION',   status: 'pending' },
    { label: 'AGENT',    status: 'pending' },
    { label: 'GOOGLE',   status: 'pending' },
    { label: 'WHATSAPP', status: 'pending' },
  ]);
  const [diagnosticIdx, setDiagnosticIdx] = useState(0);
  const [greeting, setGreeting] = useState<string>('');

  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return;
    if (sessionStorage.getItem(SESSION_KEY) === '1') return;
    setDone(false);
    sessionStorage.setItem(SESSION_KEY, '1');

    // Personalized greeting based on time of day + lang
    const lang = (typeof window !== 'undefined' ? localStorage.getItem('xjarvis:lang') : 'en') || 'en';
    const h = new Date().getHours();
    const g = lang === 'tr'
      ? (h < 6 ? 'GECE NÖBETİ — BURADAYIM PATRON' : h < 12 ? 'GÜNAYDIN PATRON' : h < 18 ? 'İYİ GÜNLER PATRON' : 'İYİ AKŞAMLAR PATRON')
      : (h < 6 ? 'NIGHT WATCH — STANDING BY' : h < 12 ? 'GOOD MORNING, SIR' : h < 18 ? 'GOOD AFTERNOON, SIR' : 'GOOD EVENING, SIR');
    setGreeting(g);

    // Trigger morning brief speech if it's 6-10am window
    if (h >= 6 && h < 10) {
      setTimeout(() => {
        fetch(`${BACKEND}/api/briefing/now`).then((r) => r.json()).then((j) => {
          if (j.ok && j.sections.length > 0) {
            const intro = lang === 'tr' ? 'Sabah brifingi: ' : 'Morning briefing: ';
            const text = intro + j.sections[0].body?.slice(0, 200);
            fetch('http://localhost:8766/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {});
          }
        }).catch(() => {});
      }, 3500);
    }

    let alive = true;

    (async () => {
      // Phase 1: arc reactor power-up (1.4s)
      await wait(1400);
      if (!alive) return;
      setPhase('subsystems');

      // Phase 2: subsystem checks
      try {
        const [svcResp, wa, gOauth] = await Promise.all([
          fetch(`${BACKEND}/api/services/state`).then((r) => r.json()).catch(() => null),
          fetch(`${BACKEND}/api/whatsapp/state`).then((r) => r.json()).catch(() => null),
          fetch(`${BACKEND}/api/google/oauth/status`).then((r) => r.json()).catch(() => null),
        ]);
        const svc = (svcResp?.services || []) as { name: string; running: boolean }[];
        const get = (n: string) => svc.find((s) => s.name === n)?.running ?? false;

        // Jira çıkarıldı (kullanıcı Atlassian kullanmıyor → boot'ta sürekli X veriyordu).
        const checks: Array<[number, 'ok' | 'fail']> = [
          [0, get('backend') ? 'ok' : 'fail'],
          [1, get('voice')   ? 'ok' : 'fail'],
          [2, get('vision')  ? 'ok' : 'fail'],
          [3, get('agent')   ? 'ok' : 'fail'],
          [4, gOauth?.connected ? 'ok' : 'fail'],
          [5, wa?.connected ? 'ok' : 'fail'],
        ];
        for (const [i, status] of checks) {
          await wait(220);
          if (!alive) return;
          setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, status } : l));
        }

        // Phase 3: diagnostic scroll
        await wait(300);
        setPhase('diagnostic');
        for (let i = 0; i < DIAGNOSTIC_LINES.length; i++) {
          await wait(180);
          if (!alive) return;
          setDiagnosticIdx(i + 1);
        }

        // Phase 4: ready
        await wait(400);
        setPhase('ready');
        await wait(1500);
        if (alive) setDone(true);
      } catch {
        if (alive) setDone(true);
      }
    })();

    return () => { alive = false; };
  }, []);

  if (done) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9990,
      background: 'radial-gradient(ellipse at center, rgba(0,12,28,0.95) 0%, rgba(0,2,6,1) 70%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
      animation: 'boot-fade 220ms ease-out both',
      flexDirection: 'column', gap: 30,
    }}>
      <style>{`
        @keyframes boot-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes reactor-power {
          0% { transform: scale(0.4); opacity: 0; box-shadow: 0 0 0 rgba(var(--hud-rgb),0); }
          50% { transform: scale(1.15); opacity: 1; box-shadow: 0 0 80px rgba(var(--hud-rgb),0.9); }
          100% { transform: scale(1); opacity: 1; box-shadow: 0 0 40px rgba(var(--hud-rgb),0.6); }
        }
        @keyframes ring-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes flash-burst {
          0% { opacity: 0; transform: scale(0.5); }
          50% { opacity: 1; transform: scale(2); }
          100% { opacity: 0; transform: scale(3); }
        }
      `}</style>

      {/* Arc Reactor */}
      <div style={{ position: 'relative', width: 200, height: 200 }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: 'radial-gradient(circle, #ffffff 0%, rgba(var(--hud-rgb),0.9) 30%, rgba(var(--hud-rgb),0.3) 70%, transparent 100%)',
          animation: 'reactor-power 1.2s ease-out both',
        }} />
        <div style={{
          position: 'absolute', inset: '-20px', borderRadius: '50%',
          border: '1px solid rgba(var(--hud-rgb),0.5)', opacity: 0.7,
          animation: 'ring-spin 6s linear infinite',
        }} />
        <div style={{
          position: 'absolute', inset: '-40px', borderRadius: '50%',
          border: '1px dashed rgba(var(--hud-rgb),0.3)',
          animation: 'ring-spin 12s linear infinite reverse',
        }} />
      </div>

      <div style={{
        fontSize: 28, letterSpacing: '0.6em', color: 'var(--hud-cyan)',
        fontFamily: 'var(--font-stack, monospace)',
        textShadow: '0 0 16px rgba(var(--hud-rgb),0.7)',
      }}>X · J · A · R · V · I · S</div>

      {/* Subsystem checklist */}
      {phase === 'subsystems' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontSize: 10, letterSpacing: '0.2em', minWidth: 380 }}>
          {lines.map((l) => (
            <div key={l.label} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '4px 12px',
              border: '1px solid rgba(var(--hud-rgb),0.2)',
              background: 'rgba(var(--hud-rgb),0.04)',
              color: 'var(--hud-cyan)',
            }}>
              <span>{l.label}</span>
              <span style={{
                color: l.status === 'ok' ? 'rgb(0,255,136)'
                     : l.status === 'fail' ? 'rgb(255,77,109)'
                     : 'rgba(var(--hud-rgb),0.5)',
              }}>{l.status === 'ok' ? '✓' : l.status === 'fail' ? '✗' : '...'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Diagnostic scroll */}
      {phase === 'diagnostic' && (
        <div style={{
          width: 540, fontSize: 10, lineHeight: 1.5,
          color: 'rgba(var(--hud-rgb),0.85)', fontFamily: 'ui-monospace, monospace',
          letterSpacing: '0.05em',
        }}>
          {DIAGNOSTIC_LINES.slice(0, diagnosticIdx).map((line, i) => (
            <div key={i} style={{ animation: 'boot-fade 180ms ease-out' }}>{line}</div>
          ))}
        </div>
      )}

      {/* Ready */}
      {phase === 'ready' && (
        <div style={{ textAlign: 'center', animation: 'boot-fade 360ms ease-out' }}>
          <div style={{
            fontSize: 18, letterSpacing: '0.4em',
            color: 'rgb(0,255,136)', textShadow: '0 0 18px rgba(0,255,136,0.7)',
            fontWeight: 300, marginBottom: 12,
          }}>{greeting || 'ALL SYSTEMS NOMINAL'}</div>
          <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: '0.3em' }}>
            XJARVIS v6.0 · MARK XL
          </div>
        </div>
      )}
    </div>
  );
}

const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
