'use client';

import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

interface AgentCard {
  id: string;
  name: string;
  role: string;
  color: string;
  toolPrefixes: string[];
}

const AGENTS: AgentCard[] = [
  { id: 'veronica', name: 'VERONICA',  role: 'AUTOMATION',         color: '#ff5555', toolPrefixes: ['shell_', 'open_app', 'applescript', 'screen_', 'window_', 'computer_use', 'mission_control', 'space_switch', 'recorder_'] },
  { id: 'vision',   name: 'THE VISION', role: 'RESEARCH · INTEL',  color: '#34d399', toolPrefixes: ['web_search', 'web_fetch', 'vision_', 'screenshot_'] },
  { id: 'ultron',   name: 'ULTRON',     role: 'CAPITAL · FINANCE',  color: '#ffb84a', toolPrefixes: ['crypto_', 'binance_'] },
  { id: 'athena',   name: 'ATHENA',     role: 'STRATEGY · LIFE OS', color: '#9b8cff', toolPrefixes: ['calendar_', 'reminders_', 'mail_', 'notify', 'plan_', 'standup_', 'focus_', 'whatsapp_', 'notion_', 'obsidian_'] },
];

interface ToolCall { name: string; ts: number }

import { BACKEND } from '@/lib/backend';

export function SubAgentsWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const [stats, setStats] = useState<Record<string, { count: number; last?: ToolCall }>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/agent/tool_calls?limit=120`);
        if (!r.ok) return;
        const j = await r.json();
        const calls: ToolCall[] = j.calls || [];
        const next: Record<string, { count: number; last?: ToolCall }> = {};
        for (const a of AGENTS) next[a.id] = { count: 0 };
        for (const c of calls) {
          const owner = AGENTS.find((a) => a.toolPrefixes.some((p) => c.name.startsWith(p)));
          if (!owner) continue;
          next[owner.id].count += 1;
          if (!next[owner.id].last || c.ts > next[owner.id].last!.ts) {
            next[owner.id].last = c;
          }
        }
        setStats(next);
      } catch { /* offline */ }
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  return (
    <WidgetShell title="Agents" position={position} width={320}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.65rem', width: '100%' }}>
        {AGENTS.map((a) => {
          const s = stats[a.id] || { count: 0 };
          const last = s.last;
          const fresh = last && Date.now() / 1000 - last.ts < 600;
          return (
            <div key={a.id}
              title={`${a.name} — bu kategori altındaki tool'lar (${a.toolPrefixes.slice(0,3).join(', ')}...) son 8 dk içinde ${s.count} kez çağrıldı. Bu liste pasif gösterimdir; agent seçimi otomatik (sorunun türüne göre).`}
              style={{
              padding: '0.4rem 0.55rem',
              border: `1px solid ${a.color}55`,
              borderLeft: `3px solid ${a.color}`,
              borderRadius: 4,
              background: 'rgba(0,0,0,0.25)',
              display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: fresh ? a.color : '#555', boxShadow: fresh ? `0 0 6px ${a.color}` : 'none' }} />
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: a.color, letterSpacing: '0.08em' }}>{a.name}</span>
                <span style={{ flex: 1, fontSize: '0.55rem', opacity: 0.55, letterSpacing: '0.1em' }}>{a.role}</span>
                <span style={{ fontSize: '0.55rem', opacity: 0.7, fontFamily: 'monospace' }}>{s.count} · queue 0</span>
              </div>
              <div style={{ fontSize: '0.55rem', opacity: 0.65, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {last ? `Last: ${last.name}` : '— idle'}
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
