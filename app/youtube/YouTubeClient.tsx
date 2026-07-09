'use client';

import { useEffect, useMemo, useState } from 'react';
import { CoverIframe } from '@/components/CoverIframe';

import { BACKEND } from '@/lib/backend';

interface Channel {
  id: string;
  label: string;
  handle?: string;
  videoId?: string;
  channelId?: string;
  custom?: boolean;
}

const DEFAULT_CHANNELS: Channel[] = [
  { id: 'tv100',     label: 'TV100',         handle: 'tv100' },
  { id: 'ntv',       label: 'NTV',           handle: 'NTV' },
  { id: 'cnnturk',   label: 'CNN Türk',      handle: 'cnnturk' },
  { id: 'ahaber',    label: 'A Haber',       handle: 'Ahaber' },
  { id: 'halktv',    label: 'Halk TV',       handle: 'Halktvkanali' },
  { id: 'tgrt',      label: 'TGRT Haber',    handle: 'tgrthaber' },
  { id: 'cnbce',     label: 'CNBC-E',        handle: 'cnbce' },
  { id: 'tvnet',     label: 'TVNET',         handle: 'TVNET' },
  { id: 'sky',       label: 'Sky News',      handle: 'SkyNews' },
  { id: 'aljazeera', label: 'Al Jazeera',    handle: 'aljazeeraenglish' },
  { id: 'dw',        label: 'DW News',       handle: 'dwnews' },
  { id: 'bloomberg', label: 'Bloomberg TV',  handle: 'BloombergTelevision' },
  { id: 'cnbc',      label: 'CNBC',          handle: 'CNBC' },
  { id: 'france24',  label: 'France 24',     handle: 'FRANCE24English' },
  { id: 'bbc',       label: 'BBC News',      handle: 'BBCNews' },
];

interface LayoutPreset {
  id: string;
  label: string;
  cells: number;
  // grid-template-areas — cell isimleri c1..cN
  areas: string;
  cols: string;
  rows: string;
}

const LAYOUTS: LayoutPreset[] = [
  {
    id: 'hero7', label: '7-PANE', cells: 7,
    areas: '"c1 c1 c2 c3" "c1 c1 c4 c5" "c6 c6 c7 c7"',
    cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr 1fr',
  },
  {
    id: '1plus6', label: '1+6', cells: 7,
    areas: '"c1 c1 c1 c2" "c1 c1 c1 c3" "c4 c5 c6 c7"',
    cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr 1fr',
  },
  {
    id: 'grid4x2', label: '4×2', cells: 8,
    areas: '"c1 c2 c3 c4" "c5 c6 c7 c8"',
    cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr',
  },
  {
    id: 'grid3x3', label: '3×3', cells: 9,
    areas: '"c1 c2 c3" "c4 c5 c6" "c7 c8 c9"',
    cols: '1fr 1fr 1fr', rows: '1fr 1fr 1fr',
  },
  {
    id: '2plus4', label: '2+4', cells: 6,
    areas: '"c1 c1 c2 c2" "c3 c4 c5 c6"',
    cols: '1fr 1fr 1fr 1fr', rows: '2fr 1fr',
  },
];

const LS_LAYOUT = 'xjarvis:youtube:layout';
const LS_CELLS  = 'xjarvis:youtube:cells';
const LS_CUSTOM = 'xjarvis:youtube:custom';

function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { const v = window.localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function saveLS<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}

export function YouTubeClient() {
  const [layoutId, setLayoutId] = useState<string>('hero7');
  const [customChannels, setCustomChannels] = useState<Channel[]>([]);
  const [cellChannels, setCellChannels] = useState<string[]>([]); // cell index → channel.id
  const [urlInput, setUrlInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [unmuted, setUnmuted] = useState<number | null>(null);

  const layout = useMemo(() => LAYOUTS.find((l) => l.id === layoutId) || LAYOUTS[0], [layoutId]);
  const allChannels = useMemo(() => [...DEFAULT_CHANNELS, ...customChannels], [customChannels]);

  useEffect(() => {
    // localStorage hydration — must run after mount for SSR safety
    /* eslint-disable react-hooks/set-state-in-effect */
    setLayoutId(loadLS<string>(LS_LAYOUT, 'hero7'));
    setCustomChannels(loadLS<Channel[]>(LS_CUSTOM, []));
    setCellChannels(loadLS<string[]>(LS_CELLS, ['tv100', 'ntv', 'cnnturk', 'sky', 'bbc', 'aljazeera', 'dw', 'cnbc', 'bloomberg']));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => { saveLS(LS_LAYOUT, layoutId); }, [layoutId]);
  useEffect(() => { saveLS(LS_CUSTOM, customChannels); }, [customChannels]);
  useEffect(() => { saveLS(LS_CELLS, cellChannels); }, [cellChannels]);

  const setCell = (index: number, channelId: string) => {
    setCellChannels((prev) => {
      const next = [...prev];
      while (next.length < index + 1) next.push('tv100');
      next[index] = channelId;
      return next;
    });
  };

  const addCustomFromUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setResolving(true);
    try {
      const r = await fetch(`${BACKEND}/api/youtube/resolve-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await r.json();
      if (!data.ok) { alert(data.error || 'çözümlenemedi'); return; }
      const id = `custom_${Date.now()}`;
      const label = data.title || data.handle || (data.videoId ? `Video ${data.videoId.slice(0, 6)}` : 'Custom');
      const ch: Channel = {
        id, label, custom: true,
        handle: data.handle, videoId: data.videoId, channelId: data.channelId,
      };
      setCustomChannels((prev) => [...prev, ch]);
      setUrlInput('');
    } catch {
      alert('bağlantı hatası');
    } finally { setResolving(false); }
  };

  const removeCustom = (id: string) => {
    setCustomChannels((prev) => prev.filter((c) => c.id !== id));
    setCellChannels((prev) => prev.map((cid) => cid === id ? 'tv100' : cid));
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-base)', minHeight: 0,
    }}>
      {/* TOPBAR */}
      <div className="hud-font" style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(var(--hud-rgb),0.18)',
        background: 'rgba(0,8,20,0.55)',
      }}>
        <span style={{
          fontSize: 11, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700,
        }}>◢ MULTI-PANE</span>

        <div style={{ display: 'flex', gap: 4 }}>
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLayoutId(l.id)}
              style={{
                padding: '5px 11px', fontSize: 10, letterSpacing: '0.16em',
                background: layoutId === l.id ? 'rgba(var(--hud-rgb),0.2)' : 'transparent',
                border: `1px solid ${layoutId === l.id ? 'rgba(var(--hud-rgb),0.55)' : 'var(--border)'}`,
                color: layoutId === l.id ? 'var(--hud-cyan)' : 'var(--text-secondary)',
                borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
              }}
            >{l.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 220 }}>
          <input
            type="text" value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addCustomFromUrl(); }}
            placeholder="YouTube URL veya @handle yapıştır…"
            style={{
              flex: 1, padding: '6px 10px', fontSize: 11,
              background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', borderRadius: 4, fontFamily: 'inherit',
            }}
          />
          <button
            onClick={addCustomFromUrl} disabled={resolving || !urlInput.trim()}
            style={{
              padding: '6px 14px', fontSize: 10, letterSpacing: '0.16em',
              background: 'rgba(var(--hud-rgb),0.18)',
              border: '1px solid rgba(var(--hud-rgb),0.5)',
              color: 'var(--hud-cyan)', borderRadius: 4,
              cursor: resolving ? 'wait' : 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
            }}
          >{resolving ? '…' : '+ EKLE'}</button>
        </div>

        {customChannels.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {customChannels.map((c) => (
              <span key={c.id} style={{
                fontSize: 9, padding: '3px 7px', borderRadius: 12,
                background: 'rgba(var(--hud-rgb),0.1)', color: 'var(--hud-cyan)',
                border: '1px solid rgba(var(--hud-rgb),0.3)',
              }}>
                {c.label}
                <button
                  onClick={() => removeCustom(c.id)}
                  style={{ marginLeft: 6, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* GRID */}
      <div style={{
        flex: 1, padding: 8, minHeight: 0,
        display: 'grid',
        gridTemplateAreas: layout.areas,
        gridTemplateColumns: layout.cols,
        gridTemplateRows: layout.rows,
        gap: 6,
      }}>
        {Array.from({ length: layout.cells }).map((_, i) => (
          <Cell
            key={`${layoutId}-${i}`}
            area={`c${i + 1}`}
            channelId={cellChannels[i] || 'tv100'}
            channels={allChannels}
            unmuted={unmuted === i}
            onUnmute={() => setUnmuted(unmuted === i ? null : i)}
            onChange={(cid) => setCell(i, cid)}
          />
        ))}
      </div>
    </div>
  );
}

function Cell({ area, channelId, channels, unmuted, onUnmute, onChange }: {
  area: string;
  channelId: string;
  channels: Channel[];
  unmuted: boolean;
  onUnmute: () => void;
  onChange: (channelId: string) => void;
}) {
  const channel = useMemo(() => channels.find((c) => c.id === channelId) || channels[0], [channels, channelId]);
  const [vid, setVid] = useState<string | null>(null);
  const [chId, setChId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!channel) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLive(false); setLoading(true);
    if (channel.videoId) {
      setVid(channel.videoId); setChId(channel.channelId || null); setLive(true); setLoading(false);
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    if (channel.channelId && !channel.handle) {
      setVid(null); setChId(channel.channelId); setLoading(false);
      return;
    }
    if (channel.handle) {
      fetch(`${BACKEND}/api/youtube/live?handle=${encodeURIComponent(channel.handle)}`)
        .then((r) => r.json())
        .then((d) => {
          setVid(d?.videoId || null);
          setChId(d?.channelId || null);
          setLive(!!d?.ok);
        })
        .catch(() => { setVid(null); setChId(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [channel]);

  const muteParam = unmuted ? '0' : '1';
  const url = vid
    ? `${BACKEND}/api/youtube/embed?video=${vid}&mute=${muteParam}`
    : chId ? `${BACKEND}/api/youtube/embed?channel=${chId}&mute=${muteParam}` : null;

  return (
    <div style={{
      gridArea: area,
      position: 'relative', overflow: 'hidden', borderRadius: 4,
      background: '#000', border: `1px solid ${unmuted ? 'rgba(var(--hud-rgb),0.7)' : 'rgba(var(--hud-rgb),0.25)'}`,
      boxShadow: unmuted ? 'inset 0 0 0 1px rgba(var(--hud-rgb),0.3), 0 0 24px rgba(var(--hud-rgb),0.18)' : 'none',
    }}>
      <div style={{
        position: 'absolute', top: 6, left: 6, zIndex: 5,
        display: 'flex', gap: 4, alignItems: 'center',
        background: 'rgba(0,0,0,0.65)', padding: '2px 7px', borderRadius: 2,
        fontSize: 9, color: 'var(--hud-cyan)', letterSpacing: '0.18em',
      }}>
        {live && <span style={{
          width: 6, height: 6, borderRadius: '50%', background: '#ff3333',
          boxShadow: '0 0 6px #ff3333', display: 'inline-block',
        }} />}
        {live && <span style={{ color: '#ff5555', fontWeight: 700 }}>LIVE</span>}
        <span>{channel?.label || '—'}</span>
      </div>

      <select
        value={channelId}
        onChange={(e) => onChange(e.target.value)}
        style={{
          position: 'absolute', top: 6, right: 36, zIndex: 5,
          background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(var(--hud-rgb),0.4)',
          color: 'var(--hud-cyan)', fontSize: 9, padding: '2px 6px',
          fontFamily: 'inherit', cursor: 'pointer', borderRadius: 2, maxWidth: 120,
        }}
      >
        {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>

      <button
        onClick={onUnmute}
        title={unmuted ? 'Sesi kapat' : 'Sesi aç'}
        style={{
          position: 'absolute', top: 6, right: 6, zIndex: 5,
          background: unmuted ? 'rgba(var(--hud-rgb),0.3)' : 'rgba(0,0,0,0.7)',
          border: '1px solid rgba(var(--hud-rgb),0.4)', borderRadius: 2,
          color: unmuted ? '#fff' : 'var(--hud-cyan)', fontSize: 11, padding: '1px 6px',
          cursor: 'pointer',
        }}
      >{unmuted ? '🔊' : '🔇'}</button>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', opacity: 0.5, fontSize: 10, color: 'var(--text-secondary)' }}>
          yükleniyor…
        </div>
      ) : url ? (
        <CoverIframe src={url} iframeKey={url} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', opacity: 0.5, fontSize: 10, color: 'var(--text-secondary)' }}>
          canlı yayın yok
        </div>
      )}
    </div>
  );
}
