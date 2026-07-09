'use client';
import { useEffect, useState } from 'react';
import { C, MONO, SANS } from './theme';
import { ClassicCard } from './ClassicCard';
import { BACKEND, usePoll, getJSON } from './useBackend';

/* ---------- ortak küçük parçalar ---------- */

function Stat({ label, value, accent = C.text }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.faint }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 600, color: accent, fontFamily: MONO }}>{value}</span>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: color, borderRadius: 3, transition: 'width 500ms ease' }} />
    </div>
  );
}

const chColor = (c: number) => (c > 0 ? C.pos : c < 0 ? C.neg : C.muted);
const chTxt = (c: number) => `${c > 0 ? '+' : ''}${c.toFixed(2)}%`;

/* ---------- Clock ---------- */

export function ClockCard({ span = 1 }: { span?: number } = {}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const time = now ? now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--';
  const date = now ? now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  return (
    <ClassicCard span={span} title="Saat" accent={C.violet}>
      <div style={{ fontSize: 40, fontWeight: 300, letterSpacing: '0.04em', fontFamily: MONO, color: C.text, lineHeight: 1 }}>{time}</div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 8, textTransform: 'capitalize' }}>{date}</div>
    </ClassicCard>
  );
}

/* ---------- Weather ---------- */

interface WX { temp: number; hum: number; wind: number; code: number; hourly: number[] }
const wxIcon = (c: number) => (c === 0 ? '☀︎' : c < 4 ? '⛅︎' : c < 50 ? '☁︎' : c < 70 ? '🌧' : c < 80 ? '❄︎' : '⛈');
async function fetchWX(): Promise<WX> {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&hourly=temperature_2m&forecast_days=1&timezone=Europe%2FIstanbul';
  const d = await getJSON<any>(url);
  const h = new Date().getHours();
  const arr: number[] = d.hourly?.temperature_2m ?? [];
  return { temp: d.current.temperature_2m, hum: d.current.relative_humidity_2m, wind: d.current.wind_speed_10m, code: d.current.weather_code, hourly: arr.slice(h, h + 6) };
}
export function WeatherCard({ span = 1 }: { span?: number } = {}) {
  const { data } = usePoll(fetchWX, 600_000);
  const min = data ? Math.min(...data.hourly) : 0;
  const max = data ? Math.max(...data.hourly) : 1;
  return (
    <ClassicCard span={span} title="Hava · Balıkesir" accent={C.mint}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 30 }}>{data ? wxIcon(data.code) : '—'}</span>
        <span style={{ fontSize: 38, fontWeight: 600, fontFamily: MONO }}>{data ? Math.round(data.temp) : '--'}°</span>
        <span style={{ fontSize: 12, color: C.muted }}>{data ? `%${data.hum} · ${Math.round(data.wind)} km/s` : ''}</span>
      </div>
      {data && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 36, marginTop: 10 }}>
          {data.hourly.map((tp, i) => {
            const hgt = max === min ? 50 : 14 + ((tp - min) / (max - min)) * 22;
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{ width: '70%', height: hgt, borderRadius: 3, background: `linear-gradient(180deg, ${C.mint}, ${C.violet}66)` }} />
                <span style={{ fontSize: 9, color: C.faint }}>{Math.round(tp)}</span>
              </div>
            );
          })}
        </div>
      )}
    </ClassicCard>
  );
}

/* ---------- System ---------- */

interface Sys { cpu: number; mem?: number; temp: number | null; battery: number | null }
export function SystemCard({ span = 1 }: { span?: number } = {}) {
  const { data } = usePoll(() => getJSON<Sys>(`${BACKEND}/api/system-stats`), 5000);
  const cpu = data?.cpu ?? 0;
  const mem = data?.mem ?? 0;
  const bat = data?.battery;
  const batColor = bat == null ? C.faint : bat >= 50 ? C.pos : bat >= 20 ? C.amberSoft : C.coral;
  return (
    <ClassicCard span={span} title="Sistem" accent={C.violet}>
      <div style={{ display: 'flex', gap: 18, marginBottom: 12 }}>
        <Stat label="CPU" value={`${Math.round(cpu)}%`} accent={cpu > 80 ? C.coral : C.text} />
        <Stat label="RAM" value={`${Math.round(mem)}%`} />
        <Stat label="Isı" value={data?.temp != null ? `${data.temp.toFixed(0)}°` : '—'} />
        <Stat label="Pil" value={bat != null ? `${Math.round(bat)}%` : '—'} accent={batColor} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div><div style={{ fontSize: 9, color: C.faint, marginBottom: 3 }}>CPU</div><Bar pct={cpu} color={C.mint} /></div>
        <div><div style={{ fontSize: 9, color: C.faint, marginBottom: 3 }}>RAM</div><Bar pct={mem} color={C.violet} /></div>
        {bat != null && <div><div style={{ fontSize: 9, color: C.faint, marginBottom: 3 }}>PİL</div><Bar pct={bat} color={batColor} /></div>}
      </div>
    </ClassicCard>
  );
}

/* ---------- Markets (indices) ---------- */

interface Idx { name: string; price: number; change: number }
const IDX_SYMBOLS = [
  { name: 'S&P 500', symbol: '%5EGSPC' },
  { name: 'NASDAQ', symbol: '%5EIXIC' },
  { name: 'BIST 100', symbol: 'XU100.IS' },
  { name: 'DAX', symbol: '%5EGDAXI' },
  { name: 'FTSE', symbol: '%5EFTSE' },
  { name: 'Nikkei', symbol: '%5EN225' },
];
async function fetchIdx(): Promise<Idx[]> {
  const syms = IDX_SYMBOLS.map((s) => s.symbol).join(',');
  const d = await getJSON<any>(`${BACKEND}/api/markets/indices?symbols=${syms}`);
  const results = d?.results ?? [];
  return IDX_SYMBOLS.map((s, i) => ({ name: s.name, price: Number(results[i]?.price ?? 0), change: Number(results[i]?.change ?? 0) }));
}
export function MarketsCard({ span = 1 }: { span?: number } = {}) {
  const { data } = usePoll(fetchIdx, 60_000);
  const rows = (data ?? []).slice(0, 6);
  return (
    <ClassicCard span={span} title="Endeksler" accent={C.coral}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {rows.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>—</span>}
        {rows.map((r) => (
          <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: C.muted }}>{r.name}</span>
            <span style={{ fontFamily: MONO, color: chColor(r.change) }}>{chTxt(r.change)}</span>
          </div>
        ))}
      </div>
    </ClassicCard>
  );
}

/* ---------- Crypto / Forex ---------- */

interface Row { sym: string; price: number; change: number }
async function fetchCrypto(): Promise<Row[]> {
  const out: Row[] = [];
  try {
    const cg = await getJSON<any>('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true');
    if (cg.bitcoin) out.push({ sym: 'BTC', price: cg.bitcoin.usd, change: cg.bitcoin.usd_24h_change });
    if (cg.ethereum) out.push({ sym: 'ETH', price: cg.ethereum.usd, change: cg.ethereum.usd_24h_change });
  } catch { /* skip */ }
  try {
    const fx = await getJSON<any>('https://open.er-api.com/v6/latest/USD');
    const t = fx?.rates?.TRY, e = fx?.rates?.EUR;
    if (t) out.push({ sym: 'USD/TRY', price: t, change: 0 });
    if (t && e) out.push({ sym: 'EUR/TRY', price: t / e, change: 0 });
  } catch { /* skip */ }
  return out;
}
export function CryptoCard({ span = 1 }: { span?: number } = {}) {
  const { data } = usePoll(fetchCrypto, 60_000);
  const rows = data ?? [];
  return (
    <ClassicCard span={span} title="Piyasa" accent={C.mint}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>—</span>}
        {rows.map((r) => (
          <div key={r.sym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: C.muted }}>{r.sym}</span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ fontFamily: MONO, color: C.text }}>{r.price > 100 ? r.price.toLocaleString('en-US', { maximumFractionDigits: 0 }) : r.price.toFixed(2)}</span>
              {r.change !== 0 && <span style={{ fontFamily: MONO, fontSize: 11, color: chColor(r.change) }}>{chTxt(r.change)}</span>}
            </span>
          </div>
        ))}
      </div>
    </ClassicCard>
  );
}

/* ---------- Now Playing ---------- */

interface Now { title: string; artist: string; state: 'playing' | 'paused' | 'stopped' }
export function NowPlayingCard({ span = 1 }: { span?: number } = {}) {
  const { data } = usePoll(async () => {
    try { const j = await getJSON<Now>(`${BACKEND}/api/now-playing`); return j?.title ? j : null; } catch { return null; }
  }, 5000);
  const ctrl = (action: string) => fetch(`${BACKEND}/api/now-playing/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => {});
  const playing = data?.state === 'playing';
  const Btn = ({ ic, a, big }: { ic: string; a: string; big?: boolean }) => (
    <button onClick={() => ctrl(a)} style={{
      width: big ? 40 : 32, height: big ? 40 : 32, borderRadius: '50%', cursor: 'pointer',
      border: `1px solid ${C.cardBorder}`, background: big ? C.mint : 'rgba(255,255,255,0.04)',
      color: big ? '#06231d' : C.text, fontSize: big ? 15 : 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'transform 150ms', fontFamily: SANS,
    }}>{ic}</button>
  );
  return (
    <ClassicCard span={span} title="Çalıyor" accent={C.violet}>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data?.title || '— parça yok —'}</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data?.artist || ''}</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
        <Btn ic="⏮" a="previous" />
        <Btn ic={playing ? '❚❚' : '▶'} a="playpause" big />
        <Btn ic="⏭" a="next" />
      </div>
    </ClassicCard>
  );
}

/* ---------- Voice / Control ---------- */

interface Ctrl { camera: { on: boolean; available: boolean }; mic: { on: boolean; available: boolean }; volume: number | null }
export function VoiceControlCard({ span = 1 }: { span?: number } = {}) {
  const [s, setS] = useState<Ctrl | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => { try { setS(await getJSON<Ctrl>(`${BACKEND}/api/control/state`)); } catch { /* */ } };
  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, []);
  const post = async (path: string) => {
    setBusy(true);
    try { await fetch(`${BACKEND}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await refresh(); } catch { /* */ } finally { setBusy(false); }
  };
  const Toggle = ({ label, on, dis, onClick }: { label: string; on: boolean; dis?: boolean; onClick: () => void }) => (
    <button disabled={dis || busy} onClick={onClick} style={{
      flex: 1, padding: '10px 8px', borderRadius: 10, cursor: dis ? 'not-allowed' : 'pointer',
      border: `1px solid ${on ? C.mint + '66' : C.cardBorder}`,
      background: on ? `${C.mint}1a` : 'rgba(255,255,255,0.03)',
      color: on ? C.mint : C.muted, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
      textTransform: 'uppercase', fontFamily: SANS, opacity: dis ? 0.4 : 1,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    }}>
      <span style={{ fontSize: 16 }}>{label === 'Mikrofon' ? '🎙' : label === 'Kamera' ? '📷' : '◉'}</span>
      {label}
      <span style={{ fontSize: 9, color: on ? C.mint : C.faint }}>{on ? 'AÇIK' : 'KAPALI'}</span>
    </button>
  );
  return (
    <ClassicCard span={span} title="Kontrol" accent={C.coral}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Toggle label="XJarvis" on={true} onClick={() => post('/api/control/jarvis')} />
        <Toggle label="Mikrofon" on={s?.mic.on ?? false} dis={!s?.mic.available} onClick={() => post('/api/control/mic')} />
        <Toggle label="Kamera" on={s?.camera.on ?? false} dis={!s?.camera.available} onClick={() => post('/api/control/camera')} />
      </div>
    </ClassicCard>
  );
}
