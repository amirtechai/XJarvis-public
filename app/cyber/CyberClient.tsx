'use client';
import { useEffect, useState } from 'react';
import { JarvisOrb } from '@/components/orb/JarvisOrb';
import { StereoWaveform } from '@/components/StereoWaveform';
import { ScrollingTicker } from '@/components/ScrollingTicker';
import { DashboardHamburger } from '@/components/dashboard/DashboardHamburger';

import { BACKEND } from '@/lib/backend';

interface InboxCounts {
  gmail_unread: number;
  jira_open: number;
  linear_open: number;
  whatsapp_pending: number;
  github_prs: number;
}

interface ActionItem { type: string; title: string; url?: string; meta?: string }
interface ScheduleItem { time: string; title: string; status: string }

export function CyberClient() {
  const [counts, setCounts] = useState<InboxCounts>({ gmail_unread: 0, jira_open: 0, linear_open: 0, whatsapp_pending: 0, github_prs: 0 });
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [revenue, setRevenue] = useState<{ today: number; mtd: number }>({ today: 0, mtd: 0 });

  useEffect(() => {
    const load = async () => {
      try {
        const [gmail, jira, prs, wa] = await Promise.all([
          fetch(`${BACKEND}/api/google/gmail/list?q=is:unread&max=5`).then((r) => r.json()).catch(() => null),
          fetch(`${BACKEND}/api/atlassian/issues/search?max=10`).then((r) => r.json()).catch(() => null),
          fetch(`${BACKEND}/api/whatsapp/state`).then((r) => r.json()).catch(() => null),
          fetch(`${BACKEND}/api/whatsapp/messages`).then((r) => r.json()).catch(() => null),
        ]);
        setCounts({
          gmail_unread: gmail?.count || 0,
          jira_open: jira?.count || 0,
          linear_open: 0,
          whatsapp_pending: wa?.inbox_count || 0,
          github_prs: 0,
        });
        const a: ActionItem[] = [];
        for (const item of (gmail?.items || []).slice(0, 4)) {
          a.push({ type: 'mail', title: (item.subject || '').slice(0, 80), meta: (item.from || '').split('<')[0].trim().slice(0, 30) });
        }
        for (const item of (jira?.items || []).slice(0, 3)) {
          a.push({ type: 'jira', title: `[${item.key}] ${item.summary}`, meta: item.status });
        }
        setActions(a);
      } catch { /* offline */ }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <main style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: 'radial-gradient(circle at 50% 0%, rgba(10,8,36,0.55) 0%, rgba(5,4,16,0.72) 70%)',
      color: 'var(--hud-cyan)', fontFamily: 'var(--font-stack, monospace)',
    }}>
      {/* Cyber neon grid background */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0,
        backgroundImage:
          'linear-gradient(rgba(var(--hud-rgb),0.08) 1px, transparent 1px), ' +
          'linear-gradient(90deg, rgba(var(--hud-rgb),0.08) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 6 }}>
        <ScrollingTicker />
        <div style={{
          height: 40, padding: '0 16px',
          background: 'linear-gradient(180deg, rgba(0,12,28,0.95), rgba(0,12,28,0.5))',
          borderBottom: '1px solid rgba(var(--hud-rgb),0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11, letterSpacing: '0.3em', color: 'rgba(var(--hud-rgb),0.85)' }}>
            CYBER · UNIFIED INBOX + ACTION QUEUE
          </span>
          <span style={{ fontSize: 13, color: '#9ed8ff', letterSpacing: '0.4em' }}>X J A R V I S</span>
          <DashboardHamburger />
        </div>
      </div>

      <div style={{ position: 'absolute', top: 80, left: 12, right: 12, bottom: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '160px 1fr 1fr', gap: 10 }}>

        {/* TOP ROW — counters */}
        {([
          { l: 'GMAIL UNREAD', v: counts.gmail_unread, c: '#ef4444' },
          { l: 'JIRA OPEN', v: counts.jira_open, c: '#7dd3fc' },
          { l: 'WHATSAPP', v: counts.whatsapp_pending, c: '#34d399' },
        ] as const).map((m) => (
          <CyberCard key={m.l} title={m.l}>
            <div style={{ fontSize: 64, lineHeight: 1, fontWeight: 700, color: m.c, textShadow: `0 0 16px ${m.c}80` }}>{m.v}</div>
            <div style={{ fontSize: 9, opacity: 0.6, marginTop: 8, letterSpacing: '0.2em' }}>{m.l}</div>
          </CyberCard>
        ))}

        {/* MID — action queue (sol 2 col) */}
        <div style={{ gridColumn: 'span 2', gridRow: 'span 2' }}>
          <CyberCard title="ACTION QUEUE">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, lineHeight: 1.4, height: '100%', overflowY: 'auto', paddingRight: 4 }}>
              {actions.length === 0 && <div style={{ opacity: 0.5 }}>Boş — şu an eylem bekleyen yok.</div>}
              {actions.map((a, i) => (
                <div key={i} style={{
                  padding: '6px 10px', borderLeft: `2px solid ${a.type === 'mail' ? '#ef4444' : '#7dd3fc'}`,
                  background: 'rgba(var(--hud-rgb),0.04)',
                }}>
                  <div style={{ fontSize: 9, opacity: 0.6, letterSpacing: '0.2em' }}>{a.type.toUpperCase()} · {a.meta}</div>
                  <div>{a.title}</div>
                </div>
              ))}
            </div>
          </CyberCard>
        </div>

        {/* RIGHT — orb + waveform */}
        <div style={{ gridRow: 'span 2', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <CyberCard title="JARVIS · LISTENING">
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <StereoWaveform side="left" height={120} width={12} />
              <JarvisOrb size={150} />
              <StereoWaveform side="right" height={120} width={12} />
            </div>
          </CyberCard>
          <CyberCard title="REVENUE">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <div style={{ opacity: 0.6, fontSize: 9, letterSpacing: '0.2em' }}>BUGÜN</div>
              <div style={{ fontSize: 22, color: '#34d399', textShadow: '0 0 10px rgba(52,211,153,0.6)' }}>$ {revenue.today.toFixed(2)}</div>
              <div style={{ opacity: 0.6, fontSize: 9, marginTop: 6, letterSpacing: '0.2em' }}>30 GÜN</div>
              <div style={{ fontSize: 16, opacity: 0.85 }}>$ {revenue.mtd.toFixed(2)}</div>
              <div style={{ opacity: 0.4, fontSize: 8, marginTop: 8 }}>RevenueCat / Stripe key bağlanınca canlı</div>
            </div>
          </CyberCard>
        </div>
      </div>
    </main>
  );
}

function CyberCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      border: '1px solid rgba(var(--hud-rgb),0.3)',
      borderRadius: 4,
      background: 'linear-gradient(180deg, rgba(0,12,28,0.7) 0%, rgba(0,8,18,0.85) 100%)',
      padding: '10px 14px',
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 0 18px rgba(var(--hud-rgb),0.1), inset 0 0 12px rgba(0,90,140,0.15)',
      position: 'relative',
    }}>
      <div style={{
        fontSize: 9, letterSpacing: '0.3em', opacity: 0.7,
        paddingBottom: 6, marginBottom: 8,
        borderBottom: '1px solid rgba(var(--hud-rgb),0.18)',
      }}>// {title}</div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
