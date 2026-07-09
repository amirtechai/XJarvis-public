'use client';

import { useState } from 'react';
import { UniversalShare } from '@/components/UniversalShare';

import { BACKEND } from '@/lib/backend';

interface Citation { title: string; url: string; snippet: string }
interface ResearchResult {
  query: string;
  summary: string | null;
  tavily_answer: string;
  citations: Citation[];
  error?: string;
}

export function ResearchClient() {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!query.trim() || busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await fetch(`${BACKEND}/api/research`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'research failed');
      setResult(j);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 20, gap: 14, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
        display: 'flex', gap: 12, alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ DEEP RESEARCH</span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Tavily web → Claude Haiku 4.5 grounded summary</span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          placeholder="Sor: e.g. 'Latest GPT-5 benchmarks vs Claude 4.7'…"
          style={{
            flex: 1, padding: '10px 14px', fontSize: 14,
            background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', borderRadius: 4, fontFamily: 'inherit',
          }}
        />
        <button
          onClick={run} disabled={busy || !query.trim()}
          style={{
            padding: '10px 22px', fontSize: 11, letterSpacing: '0.18em',
            background: 'rgba(var(--hud-rgb),0.22)',
            border: '1px solid rgba(var(--hud-rgb),0.55)',
            color: 'var(--hud-cyan)', borderRadius: 4,
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
          }}
        >{busy ? 'ARAŞTIRIYOR…' : '▶ ARAŞTIR'}</button>
      </div>

      {err && <div style={{ padding: 12, background: 'rgba(255,80,80,0.08)', color: '#ff8888', borderRadius: 4, fontSize: 12 }}>⚠ {err}</div>}

      {busy && (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', marginBottom: 12 }}>SCANNING SOURCES…</div>
          <div style={{
            width: 200, height: 2, margin: '0 auto', background: 'rgba(var(--hud-rgb),0.15)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, height: '100%', width: '40%',
              background: 'var(--hud-cyan)', animation: 'slide 1.4s ease-in-out infinite',
            }} />
            <style>{`@keyframes slide { 0%{transform:translateX(-100%);} 100%{transform:translateX(350%);} }`}</style>
          </div>
        </div>
      )}

      {result && (
        <div style={{
          flex: 1, overflowY: 'auto', display: 'flex', gap: 16, minHeight: 0,
        }}>
          <div style={{
            flex: 2, padding: 20, borderRadius: 6,
            background: 'rgba(0,8,20,0.5)',
            border: '1px solid rgba(var(--hud-rgb),0.25)',
            fontSize: 13, lineHeight: 1.65, color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="hud-font" style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--hud-cyan)' }}>
                SYNTHESIS
              </div>
              <UniversalShare
                text={result.summary || result.tavily_answer || ''}
                title={`Research: ${result.query}`}
              />
            </div>
            {result.summary || result.tavily_answer || '(empty)'}
          </div>
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', gap: 8,
            padding: 12, borderRadius: 6,
            background: 'rgba(0,8,20,0.4)',
            border: '1px solid rgba(var(--hud-rgb),0.18)',
            overflowY: 'auto', maxWidth: 360, minWidth: 280,
          }}>
            <div className="hud-font" style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--hud-cyan)', marginBottom: 6 }}>
              CITATIONS [{result.citations.length}]
            </div>
            {result.citations.map((c, i) => (
              <a key={i} href={c.url} target="_blank" rel="noreferrer" style={{
                padding: 10, borderRadius: 4,
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(var(--hud-rgb),0.18)',
                textDecoration: 'none', color: 'var(--text-primary)',
                display: 'block',
              }}>
                <div style={{ fontSize: 9, color: 'var(--hud-cyan)', letterSpacing: '0.1em', marginBottom: 3 }}>[{i + 1}]</div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{c.title}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{c.url}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {c.snippet.slice(0, 180)}{c.snippet.length > 180 ? '…' : ''}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
