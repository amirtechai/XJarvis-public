'use client';

import { useEffect, useState } from 'react';
import { JarvisOrb } from '@/components/orb/JarvisOrb';
import { ScrollingTicker } from '@/components/ScrollingTicker';
import { CoverIframe } from '@/components/CoverIframe';
import { StereoWaveform } from '@/components/StereoWaveform';
import { DashboardHamburger } from '@/components/dashboard/DashboardHamburger';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';

function openExternal(url: string) {
  fetch(`${BACKEND}/api/app/open-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }).catch(() => {});
}

import { BACKEND } from '@/lib/backend';

interface Channel {
  id: string;          // sesli komut için kısa ad ("tv100")
  label: string;       // UI'da görünen
  handle: string;      // YouTube @handle (resolve için)
  aliases?: string[];  // sesli komutta tanınan ek varyantlar
}

const TV_CHANNELS: Channel[] = [
  { id: 'tv100',       label: 'TV100',        handle: 'tv100',         aliases: ['tv yüz', 'tv 100'] },
  { id: 'tgrt',        label: 'TGRT Haber',   handle: 'tgrthaber',     aliases: ['tgrt haber', 'tgrt'] },
  { id: 'cnbce',       label: 'CNBC-E',       handle: 'cnbce',         aliases: ['cnbc e', 'cnbc', 'cinbi si'] },
  { id: 'cnnturk',     label: 'CNN Türk',     handle: 'cnnturk',       aliases: ['cnn türk', 'cnn turk'] },
  { id: 'ahaber',      label: 'A Haber',      handle: 'Ahaber',        aliases: ['a haber'] },
  { id: 'halktv',      label: 'Halk TV',      handle: 'Halktvkanali',  aliases: ['halk tv'] },
  { id: 'tvnet',       label: 'TVNET',        handle: 'TVNET',         aliases: ['tv net', 'tvnet'] },
  { id: 'ntv',         label: 'NTV',          handle: 'NTV',           aliases: ['ntv', 'en te ve'] },
  { id: 'sky',         label: 'Sky News',     handle: 'SkyNews',       aliases: ['sky news', 'sky'] },
  { id: 'aljazeera',   label: 'Al Jazeera',   handle: 'aljazeeraenglish', aliases: ['al jazeera', 'cezire', 'al cezire'] },
  { id: 'dw',          label: 'DW News',      handle: 'dwnews',        aliases: ['dw news', 'deutsche welle'] },
];

interface NewsResp { date: string; summary: string; cached?: boolean }
interface IntradayPoint { t: number; v: number }

function findChannelByVoice(text: string): Channel | null {
  const norm = text.toLowerCase().replace(/[^\wçğıöşü ]/g, '').replace(/\s+/g, ' ').trim();
  for (const c of TV_CHANNELS) {
    if (norm.includes(c.id) || norm.includes(c.label.toLowerCase())) return c;
    for (const a of (c.aliases || [])) {
      if (norm.includes(a)) return c;
    }
  }
  return null;
}

export function NewsClient() {
  const [tv, setTv] = useState<Channel>(TV_CHANNELS[0]);
  const [quad, setQuad] = useState<boolean>(false);
  const [quadChannels, setQuadChannels] = useState<Channel[]>([
    TV_CHANNELS[0], TV_CHANNELS[7], TV_CHANNELS[3], TV_CHANNELS[8],
  ]);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [search, setSearch] = useState('');
  const [news, setNews] = useState<NewsResp | null>(null);
  const [headlines, setHeadlines] = useState<string[]>([]);
  const [intraday, setIntraday] = useState<IntradayPoint[] | null>(null);
  const [chartMeta, setChartMeta] = useState<{ symbol: string; prev: number; last: number }>({ symbol: '^GSPC', prev: 0, last: 0 });

  const { lastEvent } = useJarvisEvents([EVENT_TYPES.CHANNEL_CHANGE, EVENT_TYPES.STT_FINAL]);

  // Sesli "Bloomberg aç" gibi komutlardan kanal değiştir
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.event === EVENT_TYPES.CHANNEL_CHANGE) {
      const id = (lastEvent.payload as { id?: string })?.id;
      const found = TV_CHANNELS.find((c) => c.id === id);
      if (found) setTv(found);
    } else if (lastEvent.event === EVENT_TYPES.STT_FINAL) {
      const text = (lastEvent.payload as { text?: string })?.text || '';
      // "X aç" pattern'i — TV kanalı eşleşirse anında değiştir
      if (/\b(aç|göster|geç|gir|aç bakalım|getir|izle)\b/i.test(text)) {
        const ch = findChannelByVoice(text);
        if (ch && ch.id !== tv.id) setTv(ch);
      }
    }
  }, [lastEvent, tv.id]);

  // Kanal değişince live videoId çöz
  useEffect(() => {
    let alive = true;
    setResolving(true);
    setVideoId(null);
    setChannelId(null);
    fetch(`${BACKEND}/api/youtube/live?handle=${encodeURIComponent(tv.handle)}`).then((r) => r.json()).then((d) => {
      if (!alive) return;
      setResolving(false);
      setVideoId(d?.videoId || null);
      setChannelId(d?.channelId || null);
    }).catch(() => { if (alive) setResolving(false); });
    return () => { alive = false; };
  }, [tv.handle]);

  // News + intraday
  useEffect(() => {
    let alive = true;
    fetch(`${BACKEND}/api/news/today`).then((r) => r.json()).then((d) => {
      if (!alive) return;
      setNews(d);
      const text = String(d?.summary || '').replace(/<[^>]+>/g, '\n');
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 30 && l.length < 240);
      setHeadlines(lines.slice(0, 12));
    }).catch(() => {});

    const loadIntraday = () => {
      fetch(`${BACKEND}/api/markets/intraday?symbol=%5EGSPC&interval=5m&range=1d`).then((r) => r.json()).then((d) => {
        if (!alive) return;
        const pts: IntradayPoint[] = d?.points || [];
        if (pts.length > 1) {
          setIntraday(pts);
          setChartMeta({
            symbol: 'S&P 500',
            prev: d.previous_close ?? pts[0].v,
            last: pts[pts.length - 1].v,
          });
        }
      }).catch(() => {});
    };
    loadIntraday();
    const id = setInterval(loadIntraday, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' canlı yayın')}`;
    openExternal(url);
  };

  // Prefer channel-based live embed (bypasses embed-restriction Error 153 in many cases).
  // Fall back to direct videoId embed if channelId unknown.
  // Tauri webview origin (tauri://) YouTube tarafından geçerli referrer
  // sayılmıyor → Hata 153. Çözüm: backend'den (http://127.0.0.1:3001)
  // serve edilen küçük HTML wrapper iframe içinden YouTube'u yüklüyor;
  // bu sayede iframe referrer'ı geçerli http origin'i oluyor.
  // videoId tercih ediliyor: live_stream?channel=ID bazı kanallarda
  // embed-disabled durumuna düşüyor; somut canlı videoId genelde her zaman
  // çalışıyor (playableInEmbed=true).
  const embedUrl = videoId
    ? `${BACKEND}/api/youtube/embed?video=${videoId}`
    : channelId
      ? `${BACKEND}/api/youtube/embed?channel=${channelId}`
      : null;

  return (
    <main style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: 'radial-gradient(circle at 50% 35%, rgba(10,20,36,0.55) 0%, rgba(0,10,20,0.70) 75%)',
      color: 'var(--hud-cyan, #00d4ff)',
      fontFamily: 'var(--font-orbitron, monospace)',
      animation: 'news-slide-in 380ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
    }}>
      {/* Matrix grid */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0,
        backgroundImage:
          'linear-gradient(rgba(var(--hud-rgb),0.10) 1px, transparent 1px), ' +
          'linear-gradient(90deg, rgba(var(--hud-rgb),0.10) 1px, transparent 1px), ' +
          'linear-gradient(rgba(var(--hud-rgb),0.04) 1px, transparent 1px), ' +
          'linear-gradient(90deg, rgba(var(--hud-rgb),0.04) 1px, transparent 1px)',
        backgroundSize: '120px 120px, 120px 120px, 30px 30px, 30px 30px',
        pointerEvents: 'none',
      }} />
      {/* TOP — ticker + search */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 6 }}>
        <ScrollingTicker />
        <div style={{
          height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px',
          background: 'linear-gradient(180deg, rgba(0,12,28,0.95), rgba(0,12,28,0.5))',
          borderBottom: '1px solid rgba(var(--hud-rgb),0.2)',
        }}>
          <span style={{ fontSize: 11, letterSpacing: '0.3em', color: 'rgba(var(--hud-rgb),0.85)' }}>
            NEWS · {new Date().toLocaleDateString('tr-TR')}
          </span>

          <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 480, margin: '0 24px' }}>
            <input
              type="text" value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔎 YouTube ara — kanal/video adı + Enter"
              style={{
                flex: 1, padding: '6px 12px', borderRadius: 4,
                background: 'rgba(0,8,20,0.85)',
                border: '1px solid rgba(var(--hud-rgb),0.3)',
                color: 'var(--hud-cyan)',
                fontSize: 11, fontFamily: 'inherit', outline: 'none',
              }}
            />
            <button type="submit" style={{
              padding: '6px 14px', borderRadius: 4,
              background: 'rgba(var(--hud-rgb),0.15)',
              border: '1px solid rgba(var(--hud-rgb),0.5)',
              color: 'var(--hud-cyan)',
              fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
            }}>Ara</button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#9ed8ff', textShadow: '0 0 10px rgba(var(--hud-rgb),0.6)', letterSpacing: '0.4em' }}>
              X J A R V I S
            </span>
            <DashboardHamburger />
          </div>
        </div>
      </div>

      {/* QUADRANT GRID */}
      {quad && (
        <div style={{
          position: 'absolute', top: 80, left: 12, right: 12, bottom: 12,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 6,
        }}>
          {quadChannels.map((ch, idx) => (
            <QuadCell key={ch.id} channel={ch} index={idx}
              onChange={(c) => setQuadChannels((prev) => prev.map((x, i) => i === idx ? c : x))}
            />
          ))}
          <button
            onClick={() => setQuad(false)}
            style={{
              position: 'fixed', bottom: 36, right: 16, zIndex: 30,
              background: 'rgba(0,12,28,0.95)',
              border: '1px solid rgba(var(--hud-rgb),0.7)',
              color: 'var(--hud-cyan)', padding: '8px 14px',
              fontSize: 11, letterSpacing: '0.25em', cursor: 'pointer', borderRadius: 4,
              fontFamily: 'inherit',
              boxShadow: '0 0 14px rgba(var(--hud-rgb),0.4)',
            }}
          >◰ TEK KANAL</button>
        </div>
      )}

      {!quad && <div style={{
        position: 'absolute', top: 80, left: 12, right: 12, bottom: 12,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 10,
      }}>
        {/* TL — Live TV */}
        <Pane title={`LIVE TV · ${tv.label}${resolving ? ' (yükleniyor)' : ''}`} right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              value={tv.id}
              onChange={(e) => setTv(TV_CHANNELS.find((c) => c.id === e.target.value) ?? TV_CHANNELS[0])}
              style={{
                background: 'transparent', border: '1px solid rgba(var(--hud-rgb),0.3)',
                color: 'var(--hud-cyan)', fontSize: 10, padding: '2px 8px',
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              {TV_CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <button
              onClick={() => setQuad(true)}
              title="4-kanal modu"
              style={{
                background: 'rgba(var(--hud-rgb),0.1)', border: '1px solid rgba(var(--hud-rgb),0.4)',
                color: 'var(--hud-cyan)', fontSize: 10, padding: '2px 8px',
                fontFamily: 'inherit', cursor: 'pointer', borderRadius: 3,
              }}
            >⊞ QUAD</button>
            <button
              onClick={() => {
                const u = videoId
                  ? `https://www.youtube.com/watch?v=${videoId}`
                  : `https://www.youtube.com/@${tv.handle}/live`;
                openExternal(u);
              }}
              title="YouTube'da aç"
              style={{
                background: 'rgba(var(--hud-rgb),0.1)', border: '1px solid rgba(var(--hud-rgb),0.4)',
                color: 'var(--hud-cyan)', fontSize: 10, padding: '2px 8px',
                fontFamily: 'inherit', cursor: 'pointer', borderRadius: 3,
              }}
            >▶ YouTube</button>
          </div>
        }>
          {embedUrl ? (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <CoverIframe src={embedUrl} iframeKey={channelId || videoId || 'news'} borderRadius={4} />
            </div>
          ) : (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 8,
              color: 'rgba(var(--hud-rgb),0.5)', fontSize: 11,
            }}>
              {resolving ? 'Canlı yayın aranıyor…' : 'Bu kanalın şu an canlı yayını yok.'}
              {!resolving && (
                <button
                  onClick={() => openExternal(`https://www.youtube.com/@${tv.handle}`)}
                  style={{
                    color: 'var(--hud-cyan)', background: 'transparent',
                    border: '1px solid rgba(var(--hud-rgb),0.4)',
                    padding: '4px 10px', borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 11,
                  }}
                >YouTube'da kanalı aç</button>
              )}
            </div>
          )}
        </Pane>

        {/* TR — Markets intraday chart */}
        <Pane title={`MARKETS · ${chartMeta.symbol} · INTRADAY`}>
          {intraday && intraday.length > 1 ? (
            <IntradayChart points={intraday} prev={chartMeta.prev} last={chartMeta.last} />
          ) : (
            <div style={{ opacity: 0.5, fontSize: 11, padding: 12 }}>Yükleniyor…</div>
          )}
        </Pane>

        {/* BL — Headlines */}
        <Pane title="BREAKING">
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            fontSize: 11, lineHeight: 1.4, color: '#cdebff',
            fontFamily: 'ui-monospace, monospace', overflowY: 'auto', height: '100%',
            paddingRight: 4,
          }}>
            {headlines.length === 0 && <span style={{ opacity: 0.5 }}>Yükleniyor…</span>}
            {headlines.map((h, i) => (
              <div key={`headline-${i}-${h.slice(0, 20)}`} style={{
                paddingLeft: 8, borderLeft: `2px solid ${i === 0 ? '#ef4444' : 'rgba(var(--hud-rgb),0.4)'}`,
                paddingBottom: 2,
              }}>
                {i === 0 && <span style={{ color: '#ef4444', marginRight: 6, fontWeight: 700 }}>● BREAKING</span>}
                {h}
              </div>
            ))}
          </div>
        </Pane>

        {/* BR — Jarvis orb */}
        <Pane title="JARVIS · LISTENING">
          <div style={{
            position: 'relative', width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>
            <StereoWaveform side="left" height={140} width={14} />
            <JarvisOrb size={180} />
            <StereoWaveform side="right" height={140} width={14} />
          </div>
        </Pane>
      </div>}

      <style jsx>{`
        @keyframes news-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </main>
  );
}

function Pane({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'relative',
      background: 'linear-gradient(180deg, rgba(2,18,32,0.7) 0%, rgba(0,8,20,0.85) 100%)',
      border: '1px solid rgba(var(--hud-rgb),0.3)',
      borderRadius: 6,
      padding: '8px 10px 10px',
      display: 'flex', flexDirection: 'column',
      boxShadow: 'inset 0 0 24px rgba(0,90,140,0.18), 0 0 16px rgba(var(--hud-rgb),0.12)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 10, letterSpacing: '0.22em', color: 'rgba(var(--hud-rgb),0.85)',
        paddingBottom: 4, marginBottom: 6, borderBottom: '1px solid rgba(var(--hud-rgb),0.18)',
      }}>
        <span>// {title}</span>
        {right}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

function IntradayChart({ points, prev, last }: { points: IntradayPoint[]; prev: number; last: number }) {
  const W = 600, H = 200;
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const range = max - min || 1;
  const path = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - ((p.v - min) / range) * H * 0.85 - 12;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Previous close baseline
  const prevY = prev > 0 ? H - ((prev - min) / range) * H * 0.85 - 12 : -1;
  const change = prev > 0 ? ((last - prev) / prev) * 100 : 0;
  const trendColor = change >= 0 ? '#00ff7f' : '#ff3939';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <defs>
          <linearGradient id="intraday-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={trendColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* prev close dashed */}
        {prevY > 0 && (
          <line x1="0" x2={W} y1={prevY} y2={prevY}
            stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" strokeWidth="1" />
        )}
        <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#intraday-fill)" />
        <path d={path} fill="none" stroke={trendColor} strokeWidth="2" />
      </svg>
      <div style={{
        position: 'absolute', top: 6, right: 8,
        fontSize: 18, color: trendColor, fontFamily: 'monospace',
        textShadow: `0 0 8px ${trendColor}`,
      }}>
        {change >= 0 ? '▲' : '▼'} {change.toFixed(2)}%
      </div>
      <div style={{
        position: 'absolute', top: 6, left: 8,
        fontSize: 22, color: '#fff', fontFamily: 'monospace', fontWeight: 700,
      }}>
        {last.toFixed(2)}
      </div>
      <div style={{
        position: 'absolute', bottom: 4, right: 8,
        fontSize: 9, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace',
      }}>
        {points.length} pts · prev {prev.toFixed(2)}
      </div>
    </div>
  );
}

function QuadCell({ channel, index, onChange }: { channel: Channel; index: number; onChange: (c: Channel) => void }) {
  const [vid, setVid] = useState<string | null>(null);
  const [chId, setChId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setVid(null); setChId(null);
    fetch(`${BACKEND}/api/youtube/live?handle=${encodeURIComponent(channel.handle)}`)
      .then((r) => r.json()).then((d) => { if (!alive) return; setVid(d?.videoId || null); setChId(d?.channelId || null); }).catch(() => {});
    return () => { alive = false; };
  }, [channel.handle]);
  const url = vid
    ? `${BACKEND}/api/youtube/embed?video=${vid}`
    : chId ? `${BACKEND}/api/youtube/embed?channel=${chId}` : null;
  return (
    <div style={{
      border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 4,
      background: 'rgba(0,8,20,0.85)', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 6, left: 6, zIndex: 5,
        background: 'rgba(0,0,0,0.7)', padding: '2px 6px', borderRadius: 2,
        fontSize: 9, color: 'var(--hud-cyan)', letterSpacing: '0.15em',
      }}>{channel.label}</div>
      <select
        value={channel.id}
        onChange={(e) => { const c = TV_CHANNELS.find((x) => x.id === e.target.value); if (c) onChange(c); }}
        style={{
          position: 'absolute', top: 6, right: 6, zIndex: 5,
          background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(var(--hud-rgb),0.4)',
          color: 'var(--hud-cyan)', fontSize: 9, padding: '2px 6px',
          fontFamily: 'inherit', cursor: 'pointer', borderRadius: 2,
        }}
      >
        {TV_CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      {url ? (
        <CoverIframe src={url} iframeKey={url} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', opacity: 0.5, fontSize: 10 }}>yükleniyor…</div>
      )}
    </div>
  );
}
