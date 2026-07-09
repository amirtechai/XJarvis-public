'use client';
import { useEffect, useState } from 'react';
import { JarvisOrb } from '@/components/orb/JarvisOrb';
import { StereoWaveform } from '@/components/StereoWaveform';
import { ScrollingTicker } from '@/components/ScrollingTicker';
import { DashboardHamburger } from '@/components/dashboard/DashboardHamburger';

import { BACKEND } from '@/lib/backend';

interface NewsItem { title: string; source: string; url: string; published: string }

function openExternal(url: string) {
  fetch(`${BACKEND}/api/app/open-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }).catch(() => {});
}

const CITIES = [
  { city: 'New York',  tz: 'America/New_York' },
  { city: 'London',    tz: 'Europe/London' },
  { city: 'İstanbul',  tz: 'Europe/Istanbul' },
  { city: 'Moskova',   tz: 'Europe/Moscow' },
  { city: 'Pekin',     tz: 'Asia/Shanghai' },
  { city: 'Tokyo',     tz: 'Asia/Tokyo' },
];

const SECTIONS = [
  { id: 'tr', label: 'Türkiye',  q: 'Türkiye OR İstanbul OR ekonomi OR siyaset', lang: 'tr' },
  { id: 'world', label: 'Dünya', q: 'world OR international OR global', lang: 'en' },
  { id: 'tech',  label: 'Teknoloji', q: 'AI OR technology OR startup', lang: 'en' },
  { id: 'fin',   label: 'Finans', q: 'markets OR stocks OR crypto OR bitcoin', lang: 'en' },
];

export function WorldClient() {
  const [sec, setSec] = useState(SECTIONS[1]);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const u = new URL(`${BACKEND}/api/news/headlines`);
    u.searchParams.set('lang', sec.lang);
    u.searchParams.set('q', sec.q);
    fetch(u.toString()).then((r) => r.json()).then((d) => {
      setItems(d?.items || []);
    }).catch(() => setItems([]));
  }, [sec.q, sec.lang]);

  return (
    <main style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: 'radial-gradient(circle at 50% 0%, rgba(10,20,36,0.55) 0%, rgba(2,6,12,0.72) 80%)',
      color: 'var(--hud-cyan)', fontFamily: 'var(--font-stack, monospace)',
    }}>
      {/* Stars */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0,
        backgroundImage: `radial-gradient(1px 1px at 25% 25%, rgba(255,255,255,0.4), transparent),
          radial-gradient(1px 1px at 70% 70%, rgba(255,255,255,0.3), transparent),
          radial-gradient(1px 1px at 50% 40%, rgba(var(--hud-rgb),0.4), transparent)`,
        backgroundSize: '160px 160px', pointerEvents: 'none', opacity: 0.5,
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
            WORLD WATCH · GLOBAL DESK
          </span>
          <span style={{ fontSize: 13, color: '#9ed8ff', letterSpacing: '0.4em' }}>X J A R V I S</span>
          <DashboardHamburger />
        </div>
      </div>

      <div style={{ position: 'absolute', top: 80, left: 12, right: 12, bottom: 12, display: 'grid', gridTemplateColumns: '1fr 320px', gap: 10 }}>
        {/* Sol — saatler + haber */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          {/* Dünya saatleri */}
          <div style={{
            border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4,
            background: 'rgba(0,8,18,0.7)', padding: 10,
          }}>
            <div style={{ fontSize: 9, letterSpacing: '0.3em', opacity: 0.7, marginBottom: 8 }}>// DÜNYA SAATLERİ</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              {CITIES.map((c) => {
                const t = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: c.tz });
                const d = now.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', timeZone: c.tz });
                return (
                  <div key={c.city} style={{
                    padding: '8px 6px', textAlign: 'center',
                    background: 'rgba(var(--hud-rgb),0.04)', borderRadius: 3,
                    border: '1px solid rgba(var(--hud-rgb),0.15)',
                  }}>
                    <div style={{ fontSize: 9, opacity: 0.65, letterSpacing: '0.15em' }}>{c.city.toUpperCase()}</div>
                    <div style={{ fontSize: 18, fontFamily: 'monospace', marginTop: 2 }}>{t}</div>
                    <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2 }}>{d}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 4 }}>
            {SECTIONS.map((s) => (
              <button key={s.id} onClick={() => setSec(s)}
                style={{
                  padding: '6px 14px', fontSize: 10, letterSpacing: '0.2em',
                  background: sec.id === s.id ? 'rgba(var(--hud-rgb),0.18)' : 'rgba(0,8,18,0.6)',
                  border: `1px solid rgba(var(--hud-rgb),${sec.id === s.id ? 0.7 : 0.25})`,
                  color: 'var(--hud-cyan)', fontFamily: 'inherit', borderRadius: 3, cursor: 'pointer',
                }}>{s.label.toUpperCase()}</button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={() => openExternal('https://www.worldmonitor.app/')}
              style={{
                padding: '6px 14px', fontSize: 10, letterSpacing: '0.2em',
                background: 'rgba(var(--hud-rgb),0.1)',
                border: '1px solid rgba(var(--hud-rgb),0.45)',
                color: 'var(--hud-cyan)', fontFamily: 'inherit', borderRadius: 3, cursor: 'pointer',
              }}>▶ WORLDMONITOR.APP</button>
          </div>

          {/* Haber listesi */}
          <div style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            border: '1px solid rgba(var(--hud-rgb),0.25)', borderRadius: 4,
            background: 'rgba(0,4,12,0.5)', padding: 10,
          }}>
            {items.length === 0 && <div style={{ opacity: 0.5, fontSize: 11 }}>Yükleniyor…</div>}
            {items.map((it, i) => (
              <button key={i} onClick={() => openExternal(it.url)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '8px 12px', marginBottom: 4,
                  border: '1px solid rgba(var(--hud-rgb),0.18)',
                  borderLeft: `3px solid ${i === 0 ? '#ef4444' : 'rgba(var(--hud-rgb),0.4)'}`,
                  background: 'rgba(0,16,30,0.5)',
                  color: 'var(--hud-cyan)', fontFamily: 'inherit', cursor: 'pointer',
                  borderRadius: 3,
                }}>
                <div style={{ fontSize: 9, opacity: 0.6, letterSpacing: '0.15em', marginBottom: 2 }}>
                  {it.source} · {(it.published || '').slice(11, 16)}
                  {i === 0 && <span style={{ color: '#ef4444', marginLeft: 8, fontWeight: 700 }}>● BREAKING</span>}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.35 }}>{it.title}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Sağ — orb */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4,
            background: 'rgba(0,8,18,0.7)', padding: 16,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          }}>
            <div style={{ fontSize: 9, letterSpacing: '0.3em', opacity: 0.6 }}>JARVIS · LISTENING</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StereoWaveform side="left" height={140} width={12} />
              <JarvisOrb size={180} />
              <StereoWaveform side="right" height={140} width={12} />
            </div>
          </div>
          <div style={{
            border: '1px solid rgba(var(--hud-rgb),0.25)', borderRadius: 4,
            background: 'rgba(0,8,18,0.5)', padding: 12, fontSize: 10, lineHeight: 1.5,
          }}>
            <div style={{ fontSize: 9, letterSpacing: '0.3em', opacity: 0.7, marginBottom: 6 }}>// VOICE</div>
            <div>"Jarvis dünya haritası kapat"</div>
            <div>"Jarvis Türkiye haberi"</div>
            <div>"Jarvis dünyada ne var"</div>
            <div style={{ opacity: 0.55, marginTop: 6 }}>
              WorldMonitor.app embed kabul etmiyor (X-Frame DENY). Üst sağ butondan tarayıcıda açabilirsin.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
