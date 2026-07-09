'use client';
import { useEffect, useState } from 'react';
import { JarvisOrb } from '@/components/orb/JarvisOrb';
import { ScrollingTicker } from '@/components/ScrollingTicker';
import { DashboardHamburger } from '@/components/dashboard/DashboardHamburger';

import { BACKEND } from '@/lib/backend';

interface IntradayPoint { t: number; v: number }
interface Quote { symbol: string; price: number; change_pct: number; prev_close: number }

const WATCH_SYMBOLS = ['^GSPC', '^IXIC', '^DJI', 'BTC-USD', 'ETH-USD', 'AAPL', 'TSLA', 'NVDA'];

export function TradingClient() {
  const [primary, setPrimary] = useState('^GSPC');
  const [intraday, setIntraday] = useState<IntradayPoint[] | null>(null);
  const [chartMeta, setChartMeta] = useState<{ prev: number; last: number }>({ prev: 0, last: 0 });
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [interval, setIntervalRange] = useState<{ i: string; r: string }>({ i: '5m', r: '1d' });

  useEffect(() => {
    const load = () => {
      fetch(`${BACKEND}/api/markets/intraday?symbol=${encodeURIComponent(primary)}&interval=${interval.i}&range=${interval.r}`)
        .then((r) => r.json()).then((d) => {
          const pts: IntradayPoint[] = d?.points || [];
          if (pts.length > 1) {
            setIntraday(pts);
            setChartMeta({ prev: d.previous_close ?? pts[0].v, last: pts[pts.length - 1].v });
          }
        }).catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [primary, interval]);

  useEffect(() => {
    const load = async () => {
      const out: Record<string, Quote> = {};
      const r = await fetch(`${BACKEND}/api/markets/indices?symbols=${WATCH_SYMBOLS.join(',')}`).then((r) => r.json()).catch(() => null);
      if (r?.results) {
        WATCH_SYMBOLS.forEach((s, i) => {
          const it = r.results[i];
          if (it && typeof it.price === 'number') {
            out[s] = { symbol: s, price: it.price, change_pct: it.change || 0, prev_close: 0 };
          }
        });
      }
      setQuotes(out);
    };
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);

  return (
    <main style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: 'radial-gradient(circle at 50% 0%, rgba(10,24,16,0.55) 0%, rgba(4,6,10,0.72) 80%)',
      color: 'var(--hud-cyan)', fontFamily: 'var(--font-stack, monospace)',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 6 }}>
        <ScrollingTicker />
        <div style={{
          height: 40, padding: '0 16px',
          background: 'linear-gradient(180deg, rgba(0,12,28,0.95), rgba(0,12,28,0.5))',
          borderBottom: '1px solid rgba(var(--hud-rgb),0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11, letterSpacing: '0.3em', color: 'rgba(var(--hud-rgb),0.85)' }}>
            TRADING FLOOR · {primary}
          </span>
          <span style={{ fontSize: 13, color: '#9ed8ff', letterSpacing: '0.4em' }}>X J A R V I S</span>
          <DashboardHamburger />
        </div>
      </div>

      <div style={{ position: 'absolute', top: 80, left: 12, right: 12, bottom: 12, display: 'grid', gridTemplateColumns: '180px 1fr 240px', gap: 10 }}>
        {/* Sol watchlist */}
        <div style={{ border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4, background: 'rgba(0,8,18,0.7)', overflowY: 'auto' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.3em', opacity: 0.7, padding: 10, borderBottom: '1px solid rgba(var(--hud-rgb),0.15)' }}>// WATCHLIST</div>
          {WATCH_SYMBOLS.map((s) => {
            const q = quotes[s];
            const up = q && q.change_pct >= 0;
            return (
              <button key={s} onClick={() => setPrimary(s)}
                style={{
                  width: '100%', padding: '10px 12px',
                  background: primary === s ? 'rgba(var(--hud-rgb),0.15)' : 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(var(--hud-rgb),0.1)',
                  color: 'var(--hud-cyan)', textAlign: 'left',
                  fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between',
                }}>
                <span style={{ fontWeight: 700 }}>{s}</span>
                {q ? (
                  <span style={{ color: up ? '#34d399' : '#ef4444', fontSize: 10 }}>
                    {up ? '▲' : '▼'} {Math.abs(q.change_pct).toFixed(2)}%
                  </span>
                ) : (
                  <span style={{ opacity: 0.4 }}>—</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Orta — büyük chart */}
        <div style={{ border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4, background: 'rgba(0,8,18,0.5)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid rgba(var(--hud-rgb),0.15)' }}>
            {[
              { i: '5m',  r: '1d',  l: '1G' },
              { i: '15m', r: '5d',  l: '5G' },
              { i: '1h',  r: '1mo', l: '1A' },
              { i: '1d',  r: '6mo', l: '6A' },
              { i: '1d',  r: '1y',  l: '1Y' },
            ].map((opt) => (
              <button key={opt.l} onClick={() => setIntervalRange({ i: opt.i, r: opt.r })}
                style={{
                  padding: '4px 10px', fontSize: 10, letterSpacing: '0.15em',
                  background: interval.i === opt.i && interval.r === opt.r ? 'rgba(var(--hud-rgb),0.2)' : 'transparent',
                  border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 3,
                  color: 'var(--hud-cyan)', fontFamily: 'inherit', cursor: 'pointer',
                }}
              >{opt.l}</button>
            ))}
          </div>
          <div style={{ flex: 1, position: 'relative', padding: 8 }}>
            {intraday && intraday.length > 1 ? (
              <BigChart points={intraday} prev={chartMeta.prev} last={chartMeta.last} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>yükleniyor…</div>
            )}
          </div>
        </div>

        {/* Sağ — orb + bilgi */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4, background: 'rgba(0,8,18,0.7)', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
            <JarvisOrb size={170} />
          </div>
          <div style={{ border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4, background: 'rgba(0,8,18,0.7)', padding: 12, fontSize: 10, lineHeight: 1.5 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.3em', opacity: 0.7, marginBottom: 6 }}>// VOICE</div>
            <div>"Jarvis Bitcoin nasıl"</div>
            <div>"Jarvis NVDA fiyatı"</div>
            <div>"Jarvis BIST 100 göster"</div>
            <div style={{ marginTop: 6, opacity: 0.55 }}>
              Binance + Alpaca read-only key'ler bağlanınca portföy widget'ı aktif olur.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function BigChart({ points, prev, last }: { points: IntradayPoint[]; prev: number; last: number }) {
  const W = 1000, H = 380;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals, prev), max = Math.max(...vals, prev);
  const range = (max - min) || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / range) * H;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const change = prev > 0 ? ((last - prev) / prev) * 100 : 0;
  const up = change >= 0;
  const color = up ? '#34d399' : '#ef4444';
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%">
        <defs>
          <linearGradient id="big-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={y(prev)} y2={y(prev)} stroke="rgba(255,255,255,0.3)" strokeDasharray="6 6" />
        <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#big-fill)" />
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
      </svg>
      <div style={{ position: 'absolute', top: 8, left: 12, fontSize: 32, fontWeight: 700, fontFamily: 'monospace' }}>{last.toFixed(2)}</div>
      <div style={{ position: 'absolute', top: 14, right: 12, fontSize: 22, color, fontFamily: 'monospace', textShadow: `0 0 10px ${color}` }}>
        {up ? '▲' : '▼'} {change.toFixed(2)}%
      </div>
    </div>
  );
}
