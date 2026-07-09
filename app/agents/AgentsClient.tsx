'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface AgentRun {
  id: string;
  pipeline: string;
  stage: 'planner' | 'coder' | 'reviewer' | 'tester' | 'done' | 'failed';
  prompt: string;
  started_at: number;
  finished_at?: number;
  cost_usd?: number;
  tokens_in?: number;
  tokens_out?: number;
  log_tail?: string[];
}

const STAGES: AgentRun['stage'][] = ['planner', 'coder', 'reviewer', 'tester', 'done'];
const STAGE_COLORS: Record<AgentRun['stage'], string> = {
  planner:  '#00d4ff',
  coder:    '#a78bfa',
  reviewer: '#f59e0b',
  tester:   '#34d399',
  done:     '#52525b',
  failed:   '#ef4444',
};

export function AgentsClient() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/agents/runs`, { cache: 'no-store' });
      const j = await r.json();
      setRuns(Array.isArray(j.runs) ? j.runs : []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const kill = async (id: string) => {
    if (!confirm('Run iptal edilsin mi?')) return;
    try {
      await fetch(`${BACKEND}/api/agents/runs/${id}`, { method: 'DELETE' });
      load();
    } catch { /* noop */ }
  };

  const totalCost = runs.reduce((acc, r) => acc + (r.cost_usd || 0), 0);
  const grouped = STAGES.map((s) => ({ stage: s, items: runs.filter((r) => r.stage === s) }));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 12, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        display: 'flex', gap: 16, alignItems: 'center',
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ AGENT PIPELINE</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{runs.length} run · ${totalCost.toFixed(4)}</span>
        {loading && <span style={{ fontSize: 10, opacity: 0.5 }}>refreshing…</span>}
        {err && <span style={{ fontSize: 10, color: '#ff8888' }}>⚠ {err}</span>}
      </div>

      <div style={{
        flex: 1, minHeight: 0, display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, overflow: 'hidden',
      }}>
        {grouped.map(({ stage, items }) => (
          <div key={stage} style={{
            display: 'flex', flexDirection: 'column', minHeight: 0,
            background: 'rgba(0,8,20,0.4)',
            border: `1px solid ${STAGE_COLORS[stage]}33`,
            borderRadius: 6, overflow: 'hidden',
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: `1px solid ${STAGE_COLORS[stage]}33`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{
                fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
                color: STAGE_COLORS[stage], fontWeight: 700,
              }}>{stage}</span>
              <span style={{ fontSize: 9, opacity: 0.5 }}>{items.length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.length === 0 && (
                <div style={{ padding: 16, fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', opacity: 0.4 }}>—</div>
              )}
              {items.map((r) => (
                <div key={r.id} style={{
                  padding: 10, borderRadius: 4,
                  background: 'rgba(0,0,0,0.3)',
                  border: `1px solid ${STAGE_COLORS[r.stage]}66`,
                  fontSize: 11, lineHeight: 1.4,
                }}>
                  <div style={{
                    fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-secondary)',
                    marginBottom: 4, display: 'flex', justifyContent: 'space-between',
                  }}>
                    <span>{new Date(r.started_at).toLocaleTimeString()}</span>
                    {(r.cost_usd ?? 0) > 0 && <span>${r.cost_usd?.toFixed(4)}</span>}
                  </div>
                  <div style={{ color: 'var(--text-primary)', marginBottom: 4 }}>
                    {r.prompt.slice(0, 90)}{r.prompt.length > 90 ? '…' : ''}
                  </div>
                  <div style={{ fontSize: 9, opacity: 0.6 }}>
                    {r.pipeline} · {r.tokens_in ?? 0}→{r.tokens_out ?? 0} tok
                  </div>
                  {r.stage !== 'done' && r.stage !== 'failed' && (
                    <button
                      onClick={() => kill(r.id)}
                      style={{
                        marginTop: 6, padding: '2px 8px', fontSize: 9,
                        background: 'rgba(255,80,80,0.15)',
                        border: '1px solid rgba(255,80,80,0.4)',
                        color: '#ff8888', borderRadius: 3, cursor: 'pointer',
                        fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.1em',
                      }}
                    >KILL</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {runs.length === 0 && !loading && (
        <div style={{
          padding: 20, fontSize: 12, color: 'var(--text-secondary)',
          textAlign: 'center', opacity: 0.6,
        }}>
          Henüz multi-agent run yok. <code>/api/agents/spawn</code>&apos;a POST atılınca buraya düşer.
        </div>
      )}
    </div>
  );
}
