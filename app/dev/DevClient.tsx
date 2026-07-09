'use client';
import { useEffect, useState } from 'react';
import { JarvisOrb } from '@/components/orb/JarvisOrb';
import { DashboardHamburger } from '@/components/dashboard/DashboardHamburger';

import { BACKEND } from '@/lib/backend';

interface PR { repo: string; number: number; title: string; author: string; draft: boolean; url: string; updated: string }
interface LogFile { size: number; mtime: string; tail: string[] }

export function DevClient() {
  const [prs, setPrs] = useState<PR[]>([]);
  const [logs, setLogs] = useState<Record<string, LogFile>>({});
  const [activeLog, setActiveLog] = useState<string>('');

  useEffect(() => {
    const load = async () => {
      const [p, l] = await Promise.all([
        fetch(`${BACKEND}/api/dev/prs`).then((r) => r.json()).catch(() => null),
        fetch(`${BACKEND}/api/dev/logs?lines=80`).then((r) => r.json()).catch(() => null),
      ]);
      if (p?.items) setPrs(p.items);
      if (l?.files) {
        setLogs(l.files);
        if (!activeLog) {
          const first = Object.keys(l.files)[0];
          if (first) setActiveLog(first);
        }
      }
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [activeLog]);

  return (
    <main style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: 'rgba(3,6,12,0.64)', color: 'var(--hud-cyan)',
      fontFamily: 'var(--font-stack, monospace)',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 18px',
        borderBottom: '1px solid rgba(var(--hud-rgb),0.2)',
        background: 'linear-gradient(180deg, rgba(0,12,24,0.92), rgba(0,12,24,0.4))',
      }}>
        <span style={{ fontSize: 11, letterSpacing: '0.3em', color: 'rgba(var(--hud-rgb),0.85)' }}>
          DEV MODE · PR + LOGS
        </span>
        <span style={{ fontSize: 13, color: '#9ed8ff', letterSpacing: '0.4em' }}>X J A R V I S</span>
        <DashboardHamburger />
      </div>

      <div style={{ position: 'absolute', top: 60, left: 12, right: 12, bottom: 12, display: 'grid', gridTemplateColumns: '380px 1fr 200px', gap: 10 }}>

        {/* Sol — açık PR'lar */}
        <div style={{ border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4, background: 'rgba(0,8,18,0.7)', padding: 10, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.3em', opacity: 0.7, marginBottom: 8 }}>// OPEN PULL REQUESTS · {prs.length}</div>
          {prs.length === 0 && <div style={{ opacity: 0.5, fontSize: 11 }}>Açık PR yok.</div>}
          {prs.map((p) => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer"
              style={{
                display: 'block', padding: '8px 10px', marginBottom: 4,
                border: '1px solid rgba(var(--hud-rgb),0.2)', borderRadius: 3,
                background: 'rgba(0,16,30,0.4)',
                color: 'var(--hud-cyan)', textDecoration: 'none', fontSize: 11,
              }}>
              <div style={{ fontSize: 9, opacity: 0.6, letterSpacing: '0.15em' }}>
                {p.repo} #{p.number} · {p.author} {p.draft && '· DRAFT'}
              </div>
              <div>{p.title}</div>
            </a>
          ))}
        </div>

        {/* Orta — log feed */}
        <div style={{ border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4, background: '#000206', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'flex', gap: 4, padding: 8, borderBottom: '1px solid rgba(var(--hud-rgb),0.18)',
            overflowX: 'auto',
          }}>
            {Object.keys(logs).map((f) => (
              <button key={f} onClick={() => setActiveLog(f)}
                style={{
                  padding: '4px 10px', fontSize: 10, letterSpacing: '0.1em',
                  background: activeLog === f ? 'rgba(var(--hud-rgb),0.18)' : 'rgba(0,8,18,0.6)',
                  border: `1px solid rgba(var(--hud-rgb),${activeLog === f ? 0.7 : 0.2})`,
                  color: 'var(--hud-cyan)', borderRadius: 3, cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >{f}</button>
            ))}
          </div>
          <div style={{
            flex: 1, overflowY: 'auto', padding: 8,
            fontFamily: 'ui-monospace, monospace', fontSize: 10, lineHeight: 1.35,
            color: '#9ed8ff',
          }}>
            {(logs[activeLog]?.tail || []).map((line, i) => (
              <div key={`${activeLog}-${i}`} style={{
                color: /error|fail|critical/i.test(line) ? '#ef4444'
                     : /warn/i.test(line) ? '#fbbf24'
                     : /info|✓|connected/i.test(line) ? '#34d399'
                     : '#9ed8ff',
              }}>{line}</div>
            ))}
            {!logs[activeLog] && <div style={{ opacity: 0.5 }}>Log seç...</div>}
          </div>
        </div>

        {/* Sağ — orb */}
        <div style={{ border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4, background: 'rgba(0,8,18,0.7)', padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <JarvisOrb size={140} />
          <div style={{ fontSize: 9, letterSpacing: '0.3em', opacity: 0.6, textAlign: 'center' }}>
            BUILD READY
          </div>
          <div style={{ fontSize: 10, opacity: 0.5, textAlign: 'center', lineHeight: 1.4 }}>
            "Jarvis git status"<br/>
            "Jarvis son commit"<br/>
            "Jarvis prleri listele"
          </div>
        </div>
      </div>
    </main>
  );
}
