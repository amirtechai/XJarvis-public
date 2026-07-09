'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface Episode {
  id: number;
  ts: number;
  query: string;
  response: string | null;
  tools_used: string | null;
  duration_ms: number | null;
}

interface HistoryResponse {
  total: number;
  episodes: Episode[];
  q: string;
}

export function HistoryClient() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const url = new URL(`${BACKEND}/api/agent/history`);
        url.searchParams.set('limit', '100');
        if (search) url.searchParams.set('q', search);
        const r = await fetch(url, { cache: 'no-store' });
        if (!alive) return;
        if (!r.ok) {
          setError('Agent servisi yanıt vermiyor (port 8767).');
          return;
        }
        const j = (await r.json()) as HistoryResponse;
        if (alive) { setData(j); setError(null); }
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [search]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearAll = async () => {
    if (!confirm('Tüm konuşma geçmişi silinsin mi? Bu geri alınamaz.')) return;
    await fetch(`${BACKEND}/api/agent/history`, { method: 'DELETE' });
    setData(null);
    setExpanded(new Set());
    setSearch('');
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '2rem',
        background: 'radial-gradient(circle at 50% 0%, #0a1424 0%, #050a14 70%)',
        color: 'var(--hud-cyan, #00d4ff)',
        fontFamily: 'var(--font-orbitron, monospace)',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '1.2rem', letterSpacing: '0.3em' }}>HISTORY</div>
            <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: 4 }}>
              {data ? `${data.episodes.length} / ${data.total} kayıt` : '—'}
            </div>
          </div>
          <button onClick={clearAll} style={dangerBtn}>Tümünü Sil</button>
        </header>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ara… (boşluk = son 100)"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(var(--hud-rgb),0.3)',
            color: '#fff',
            padding: '0.6rem 0.9rem',
            borderRadius: 8,
            fontSize: '0.85rem',
            fontFamily: 'monospace',
          }}
        />

        {error && (
          <div style={{ ...card, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>{error}</div>
        )}
        {loading && !data && (
          <div style={{ ...card, opacity: 0.6 }}>Yükleniyor…</div>
        )}
        {data?.episodes.length === 0 && !loading && (
          <div style={{ ...card, opacity: 0.6 }}>
            {search ? 'Eşleşme yok.' : 'Henüz konuşma kaydı yok.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data?.episodes.map((ep) => (
            <Row
              key={ep.id}
              ep={ep}
              expanded={expanded.has(ep.id)}
              onToggle={() => toggle(ep.id)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

interface ToolCall {
  id: number;
  ts: number;
  episode_id: number | null;
  name: string;
  args: Record<string, unknown>;
  result_preview: string;
}

function Row({ ep, expanded, onToggle }: { ep: Episode; expanded: boolean; onToggle: () => void }) {
  const date = new Date(ep.ts * 1000);
  const time = date.toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
  const tools = ep.tools_used ? ep.tools_used.split(',').filter(Boolean) : [];
  const [calls, setCalls] = useState<ToolCall[] | null>(null);
  const [replayResult, setReplayResult] = useState<Record<number, string>>({});
  const [replaying, setReplaying] = useState<number | null>(null);

  useEffect(() => {
    if (!expanded || calls !== null) return;
    fetch(`${BACKEND}/api/agent/tool_calls?episode_id=${ep.id}&limit=50`)
      .then((r) => r.json())
      .then((j) => setCalls(j.calls || []))
      .catch(() => setCalls([]));
  }, [expanded, ep.id, calls]);

  const replay = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setReplaying(id);
    try {
      const r = await fetch(`${BACKEND}/api/agent/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      setReplayResult((prev) => ({ ...prev, [id]: j.new_result || j.error || 'no result' }));
    } catch (err) {
      setReplayResult((prev) => ({ ...prev, [id]: String(err) }));
    } finally {
      setReplaying(null);
    }
  };

  return (
    <div className="hud-glass" style={{ borderRadius: 10, padding: '0.75rem 1rem', cursor: 'pointer' }} onClick={onToggle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: '0.7rem', color: '#52525b', fontFamily: 'monospace', minWidth: 90 }}>{time}</span>
        <span style={{ flex: 1, color: '#67e8f9', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap' }}>
          {ep.query}
        </span>
        {tools.length > 0 && (
          <span style={{ fontSize: '0.65rem', color: '#34d399', fontFamily: 'monospace' }}>
            {tools.length} 🔧
          </span>
        )}
        {ep.duration_ms != null && (
          <span style={{ fontSize: '0.65rem', color: '#a1a1aa', fontFamily: 'monospace', minWidth: 50, textAlign: 'right' }}>
            {ep.duration_ms} ms
          </span>
        )}
      </div>
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(var(--hud-rgb),0.15)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>YANIT</div>
          <div style={{ fontSize: '0.85rem', color: '#e4e4e7', whiteSpace: 'pre-wrap', fontFamily: 'system-ui, sans-serif' }}>
            {ep.response || '(boş yanıt)'}
          </div>
          {calls && calls.length > 0 && (
            <>
              <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: 6 }}>TOOL CALL'LAR · TIKLA YENİDEN ÇALIŞTIR</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {calls.map((c) => (
                  <div key={c.id} style={{
                    display: 'flex', flexDirection: 'column', gap: 4,
                    padding: '0.4rem 0.55rem',
                    background: 'rgba(52,211,153,0.06)',
                    border: '1px solid rgba(52,211,153,0.2)',
                    borderRadius: 6,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.75rem', color: '#34d399', fontFamily: 'monospace', flex: 1 }}>
                        {c.name}({Object.keys(c.args).slice(0, 3).map((k) => `${k}=${JSON.stringify(c.args[k]).slice(0, 30)}`).join(', ')})
                      </span>
                      <button
                        onClick={(e) => replay(c.id, e)}
                        disabled={replaying === c.id}
                        style={{
                          fontSize: '0.65rem', color: '#0a1424',
                          background: replaying === c.id ? '#71717a' : '#34d399',
                          border: 'none', padding: '0.2rem 0.55rem',
                          borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                        }}
                      >
                        {replaying === c.id ? '…' : 'replay'}
                      </button>
                    </div>
                    {replayResult[c.id] && (
                      <pre style={{
                        fontSize: '0.7rem', color: '#a7f3d0', margin: 0,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        fontFamily: 'monospace',
                      }}>{replayResult[c.id].slice(0, 600)}</pre>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {(!calls || calls.length === 0) && tools.length > 0 && (
            <>
              <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: 6 }}>KULLANILAN ARAÇLAR (legacy)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {tools.map((t, i) => (
                  <span key={i} style={{
                    fontSize: '0.7rem', color: '#34d399',
                    background: 'rgba(52,211,153,0.1)',
                    border: '1px solid rgba(52,211,153,0.25)',
                    padding: '0.15rem 0.45rem', borderRadius: 4,
                    fontFamily: 'monospace',
                  }}>{t}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  padding: '1.5rem',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(var(--hud-rgb),0.15)',
  textAlign: 'center',
};

const dangerBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#ef4444',
  border: '1px solid rgba(239,68,68,0.4)',
  padding: '0.45rem 1rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.8rem',
};
