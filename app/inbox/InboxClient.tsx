'use client';

import { useEffect, useMemo, useState } from 'react';
import { UniversalShare } from '@/components/UniversalShare';

import { BACKEND } from '@/lib/backend';

interface Item {
  id: string;
  source: 'gmail' | 'whatsapp' | 'jira' | 'linear' | 'telegram' | 'slack';
  from: string;
  subject: string;
  body: string;
  ts: number | string;
  url?: string;
  unread?: number;
  tier: 'skip' | 'info_only' | 'meeting_info' | 'action_required';
  status?: 'archived' | 'snoozed' | 'replied';
}

const TIER_COLOR: Record<Item['tier'], string> = {
  skip: '#52525b',
  info_only: '#7a9ab0',
  meeting_info: '#3b82f6',
  action_required: '#fbbf24',
};
const SOURCE_ICON: Record<Item['source'], string> = {
  gmail: '✉', whatsapp: '🟢', jira: '◧', linear: '☷', telegram: '✈', slack: '#',
};
const TIERS: Item['tier'][] = ['action_required', 'meeting_info', 'info_only', 'skip'];

export function InboxClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<Item['tier'] | 'all'>('all');
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/inbox/feed?limit=80`, { cache: 'no-store' });
      const j = await r.json();
      setItems(j.items || []);
    } catch { /* offline */ } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const generateDigest = async () => {
    setBusy(true); setDigest(null);
    try {
      const r = await fetch(`${BACKEND}/api/inbox/digest`);
      const j = await r.json();
      setDigest(j.text || j.error || 'no digest');
    } finally { setBusy(false); }
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return items.filter((i) => i.tier !== 'skip');
    return items.filter((i) => i.tier === filter);
  }, [items, filter]);

  const counts = useMemo(() => {
    const c: Record<Item['tier'], number> = { skip: 0, info_only: 0, meeting_info: 0, action_required: 0 };
    for (const i of items) c[i.tier]++;
    return c;
  }, [items]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 12, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ UNIFIED INBOX</span>
        <button onClick={() => setFilter('all')} style={tabBtn(filter === 'all')}>ALL ({items.length - counts.skip})</button>
        {TIERS.map((t) => (
          <button key={t} onClick={() => setFilter(t)} style={tabBtn(filter === t, TIER_COLOR[t])}>
            {t.replace('_', ' ').toUpperCase()} ({counts[t]})
          </button>
        ))}
        <button
          onClick={generateDigest} disabled={busy}
          style={{
            marginLeft: 'auto', padding: '6px 14px', fontSize: 11, letterSpacing: '0.14em',
            background: 'rgba(178,102,255,0.15)', border: '1px solid #b266ff',
            color: '#b266ff', borderRadius: 4, cursor: 'pointer',
            fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
          }}
        >{busy ? '…' : '✦ DIGEST'}</button>
      </div>

      {digest && (
        <div style={{
          padding: 14, borderRadius: 6,
          background: 'rgba(178,102,255,0.06)', border: '1px solid rgba(178,102,255,0.4)',
          color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap',
          position: 'relative',
        }}>
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            <UniversalShare text={digest} title="Daily inbox digest" compact />
          </div>
          {digest}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {loading && <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>Yükleniyor…</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-secondary)', opacity: 0.5, fontSize: 12 }}>
            Hiç item yok. Gmail / WhatsApp / Jira / Linear bağlantılarını kontrol et.
          </div>
        )}
        {filtered.slice(0, 100).map((i) => (
          <Row key={i.id} item={i} />
        ))}
      </div>
    </div>
  );
}

function Row({ item: i }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const c = TIER_COLOR[i.tier];
  return (
    <div
      onClick={() => setOpen(!open)}
      style={{
        padding: '8px 12px', borderRadius: 4, cursor: 'pointer',
        background: 'rgba(0,8,20,0.4)', borderLeft: `3px solid ${c}`,
        fontSize: 12, lineHeight: 1.4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, opacity: 0.85 }}>{SOURCE_ICON[i.source]}</span>
        <span style={{ fontSize: 9, color: c, fontWeight: 700, letterSpacing: '0.1em', minWidth: 60 }}>
          {i.tier.replace('_', ' ').toUpperCase().slice(0, 6)}
        </span>
        <span style={{ color: 'var(--text-secondary)', minWidth: 100, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {i.from.slice(0, 30)}
        </span>
        <span style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {i.subject || i.body?.slice(0, 80)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          {typeof i.ts === 'number' ? new Date(i.ts).toLocaleTimeString() : i.ts}
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 8, paddingLeft: 84, fontSize: 11, color: 'var(--text-secondary)' }}>
          <div style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', marginBottom: 6 }}>
            {i.body}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {i.url && <a href={i.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={ghostLink}>Aç ↗</a>}
            <UniversalShare text={`${i.from}\n${i.subject}\n\n${i.body}`} title={i.subject || 'Inbox item'} compact />
          </div>
        </div>
      )}
    </div>
  );
}

function tabBtn(active: boolean, color = 'var(--hud-cyan)'): React.CSSProperties {
  return {
    padding: '5px 10px', fontSize: 10, letterSpacing: '0.12em',
    background: active ? `${color === 'var(--hud-cyan)' ? 'rgba(0,212,255,0.18)' : `${color}25`}` : 'transparent',
    border: `1px solid ${active ? color : 'var(--border)'}`,
    color: active ? color : 'var(--text-secondary)',
    borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
    fontWeight: 700,
  };
}

const ghostLink: React.CSSProperties = {
  padding: '3px 8px', fontSize: 10, letterSpacing: '0.1em',
  background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(var(--hud-rgb),0.3)',
  color: 'var(--hud-cyan)', borderRadius: 3, textDecoration: 'none',
};
