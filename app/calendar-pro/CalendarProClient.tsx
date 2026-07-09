'use client';

import { useEffect, useMemo, useState } from 'react';
import { UniversalShare } from '@/components/UniversalShare';

import { BACKEND } from '@/lib/backend';

interface Event {
  id: string;
  summary: string;
  start: string;
  start_time?: string;
  end?: string;
  attendees?: Array<{ email?: string }>;
  description?: string;
  location?: string;
}

const HOURS = Array.from({ length: 24 }).map((_, i) => i);
const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export function CalendarProClient() {
  const [events, setEvents] = useState<Event[]>([]);
  const [prep, setPrep] = useState<{ event?: Event; prep?: string; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/google/calendar/upcoming?max=80`, { cache: 'no-store' });
      const j = await r.json();
      setEvents(j.events || []);
    } catch { /* offline */ } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60_000); // Refresh every 5 minutes
    return () => clearInterval(id);
  }, []);

  const loadPrep = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/calendar-prep/next`);
      setPrep(await r.json());
    } catch { /* noop */ }
  };

  // Heatmap: events grouped by day-of-week × hour-of-day
  const heatmap = useMemo(() => {
    const grid = Array.from({ length: 7 }).map(() => new Array(24).fill(0));
    for (const e of events) {
      const ts = e.start_time || e.start;
      if (!ts) continue;
      const d = new Date(ts);
      const dow = (d.getDay() + 6) % 7; // Mon=0
      const hr = d.getHours();
      grid[dow][hr]++;
    }
    return grid;
  }, [events]);

  const max = Math.max(1, ...heatmap.flat());
  const total = events.length;
  const todayCount = events.filter((e) => {
    const t = new Date(e.start_time || e.start);
    const now = new Date();
    return t.toDateString() === now.toDateString();
  }).length;
  const densityScore = Math.min(100, Math.round((total / 50) * 100));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 14, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ CALENDAR PRO</span>
        <Stat label="BUGÜN" value={String(todayCount)} />
        <Stat label="30 GÜN" value={String(total)} />
        <Stat label="DENSITY" value={`${densityScore}`} suffix="/100" color={densityScore > 70 ? '#fbbf24' : '#34d399'} />
        <button onClick={loadPrep} style={{
          marginLeft: 'auto', padding: '6px 14px', fontSize: 11, letterSpacing: '0.14em',
          background: 'rgba(178,102,255,0.15)', border: '1px solid #b266ff',
          color: '#b266ff', borderRadius: 4, cursor: 'pointer',
          fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
        }}>✦ NEXT PREP</button>
      </div>

      {prep?.prep && (
        <div style={{
          padding: 14, borderRadius: 6, position: 'relative',
          background: 'rgba(178,102,255,0.06)', border: '1px solid rgba(178,102,255,0.4)',
        }}>
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            <UniversalShare text={prep.prep} title={`Prep: ${prep.event?.summary || ''}`} compact />
          </div>
          <div style={{ fontSize: 11, color: '#b266ff', letterSpacing: '0.16em', marginBottom: 6, fontWeight: 700 }}>
            {prep.event?.summary?.toUpperCase()}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
            {prep.prep}
          </div>
        </div>
      )}

      {/* Heatmap grid */}
      <div style={{
        padding: 14, borderRadius: 6,
        background: 'rgba(0,8,20,0.45)',
        border: '1px solid rgba(var(--hud-rgb),0.18)',
      }}>
        <div className="hud-font" style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--hud-cyan)', marginBottom: 10, fontWeight: 700 }}>
          YOĞUNLUK HEATMAP (gün × saat)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', gap: 1, fontSize: 8, color: 'var(--text-secondary)' }}>
          <span></span>
          {HOURS.map((h) => (
            <span key={h} style={{ textAlign: 'center', fontFamily: 'monospace' }}>{h % 6 === 0 ? h : ''}</span>
          ))}
          {DAYS.map((day, dow) => (
            <>
              <span key={`d${dow}`} style={{ paddingRight: 6, fontFamily: 'monospace', alignSelf: 'center' }}>{day}</span>
              {HOURS.map((h) => {
                const v = heatmap[dow][h];
                const intensity = v / max;
                return (
                  <div
                    key={`${dow}-${h}`}
                    title={v > 0 ? `${day} ${h}:00 — ${v} event` : ''}
                    style={{
                      aspectRatio: '1', borderRadius: 2,
                      background: v === 0 ? 'rgba(255,255,255,0.04)' : `rgba(0, 212, 255, ${0.18 + intensity * 0.7})`,
                    }}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>

      {/* Upcoming list */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: 14, borderRadius: 6,
        background: 'rgba(0,8,20,0.4)',
        border: '1px solid rgba(var(--hud-rgb),0.18)',
      }}>
        <div className="hud-font" style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--hud-cyan)', marginBottom: 10, fontWeight: 700 }}>
          YAKLAŞAN ({events.length})
        </div>
        {loading && <div style={{ padding: 16, opacity: 0.5, textAlign: 'center' }}>Yükleniyor…</div>}
        {!loading && events.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-secondary)', opacity: 0.5, fontSize: 12, textAlign: 'center' }}>
            Yaklaşan etkinlik yok. Google Calendar bağlantısını kontrol et.
          </div>
        )}
        {events.slice(0, 30).map((e) => (
          <div key={e.id} style={{
            padding: '8px 12px', marginBottom: 4, borderRadius: 4,
            background: 'rgba(0,0,0,0.3)', borderLeft: '3px solid var(--hud-cyan)',
            fontSize: 12, lineHeight: 1.4,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600, flex: 1 }}>
                {e.summary || '(no title)'}
              </span>
              <span style={{ color: 'var(--hud-cyan)', fontFamily: 'monospace', fontSize: 11 }}>
                {new Date(e.start_time || e.start).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            {e.attendees && e.attendees.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
                {e.attendees.slice(0, 4).map((a) => a.email).join(', ')}
                {e.attendees.length > 4 && ` +${e.attendees.length - 4}`}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, suffix, color = 'var(--hud-cyan)' }: { label: string; value: string; suffix?: string; color?: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</span>
      {suffix && <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{suffix}</span>}
      <span style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--text-secondary)', marginLeft: 4 }}>{label}</span>
    </span>
  );
}
