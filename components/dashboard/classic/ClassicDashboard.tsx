'use client';
import { useEffect, useState } from 'react';
import { C, SANS, MONO } from './theme';
import { OrbStyleSwitcher } from '@/components/orb/JarvisOrb';
import { DashboardTopActions } from '@/components/dashboard/DashboardTopActions';
import { DashboardHamburger } from '@/components/dashboard/DashboardHamburger';
import {
  WeatherCard, SystemCard, MarketsCard, CryptoCard, NowPlayingCard, VoiceControlCard,
} from './cards';

function greeting(h: number) {
  if (h < 6) return 'İyi geceler';
  if (h < 12) return 'Günaydın';
  if (h < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

function HeroClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const hh = now ? now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  const ss = now ? now.toLocaleTimeString('tr-TR', { second: '2-digit' }) : '--';
  const date = now ? now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const hour = now ? now.getHours() : 12;
  return (
    <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
      <div style={{ fontSize: 15, letterSpacing: '0.32em', textTransform: 'uppercase', color: C.muted, marginBottom: 18 }}>
        {greeting(hour)}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 10 }}>
        <span style={{
          fontSize: 'clamp(72px, 12vw, 150px)', fontWeight: 200, lineHeight: 0.9,
          letterSpacing: '0.01em', color: '#F7F8FC', fontFamily: MONO,
          textShadow: '0 8px 60px rgba(0,0,0,0.55)',
        }}>{hh}</span>
        <span style={{ fontSize: 'clamp(22px,3vw,40px)', fontWeight: 300, color: C.mint, fontFamily: MONO, textShadow: `0 0 24px ${C.mint}` }}>{ss}</span>
      </div>
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.78)', marginTop: 14, textTransform: 'capitalize', letterSpacing: '0.04em' }}>{date}</div>
      <div style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 9, padding: '7px 16px',
        borderRadius: 999, background: 'rgba(16,18,26,0.4)', border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', fontSize: 12, color: 'rgba(255,255,255,0.82)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.pos, boxShadow: `0 0 10px ${C.pos}`,
          animation: 'classic-pulse 2.4s ease-in-out infinite' }} />
        Tüm sistemler çalışıyor · dinlemeye hazır
      </div>
    </div>
  );
}

export function ClassicDashboard() {
  useEffect(() => {
    document.body.setAttribute('data-classic', '1');
    return () => document.body.removeAttribute('data-classic');
  }, []);
  return (
    <main style={{
      position: 'fixed', inset: 0, overflow: 'auto',
      // Kullanıcının iridescence masaüstü duvar kâğıdı (akan video DEĞİL).
      // Hafif scrim üstte → metin/kartlar okunur; opak görsel global video'yu örter.
      background: "linear-gradient(rgba(6,7,12,0.32), rgba(4,5,9,0.52)), url('/classic-wall.jpg') center / cover no-repeat",
      backgroundAttachment: 'fixed',
      color: C.text, fontFamily: SANS,
      animation: 'classic-fade 500ms ease both',
    }}>
      <style>{`
        @keyframes classic-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes classic-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
        .classic-scroll::-webkit-scrollbar { width: 6px; }
        .classic-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 3px; }
      `}</style>

      <div className="classic-scroll" style={{ position: 'relative', zIndex: 1, maxWidth: 1280, margin: '0 auto', padding: '0 32px 48px' }}>
        {/* header */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 2px 6px' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.24em', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>Balıkesir</span>
          <span style={{
            fontSize: 20, fontWeight: 700, letterSpacing: '0.46em', paddingLeft: '0.46em',
            fontFamily: 'var(--font-orbitron, ' + SANS + ')', color: '#fff',
            textShadow: '0 0 30px rgba(255,255,255,0.25)',
          }}>XJARVIS</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a href="/news" style={{ fontSize: 10, letterSpacing: '0.2em', padding: '5px 12px', borderRadius: 9,
              border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', textDecoration: 'none',
              background: 'rgba(16,18,26,0.4)', backdropFilter: 'blur(12px)' }}>NEWS</a>
            <DashboardTopActions />
            <OrbStyleSwitcher />
            <DashboardHamburger />
          </div>
        </header>

        {/* hero — video burada yıldız, üstte sadece büyük saat */}
        <section style={{ minHeight: '46vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 0 36px' }}>
          <HeroClock />
        </section>

        {/* bento grid — değişken boyutlu frosted kartlar */}
        <section style={{
          display: 'grid', gap: 18,
          gridTemplateColumns: 'repeat(6, 1fr)',
          gridAutoRows: 'minmax(150px, auto)',
        }}>
          <WeatherCard span={4} />
          <SystemCard span={2} />
          <NowPlayingCard span={3} />
          <VoiceControlCard span={3} />
          <CryptoCard span={3} />
          <MarketsCard span={3} />
        </section>
      </div>
    </main>
  );
}
