'use client';
import { WidgetShell } from './WidgetShell';
import { usePolling } from '@/hooks/usePolling';

interface DayForecast {
  date: string;
  tmin: number;
  tmax: number;
  code: number;
}

const URL = 'https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=5&timezone=Europe%2FIstanbul';

async function fetchForecast(): Promise<DayForecast[]> {
  const r = await fetch(URL);
  if (!r.ok) throw new Error('forecast fetch failed');
  const d = await r.json();
  const dates: string[] = d.daily.time;
  return dates.map((date, i) => ({
    date,
    tmin: d.daily.temperature_2m_min[i],
    tmax: d.daily.temperature_2m_max[i],
    code: d.daily.weather_code[i],
  }));
}

const ICONS: Record<number, string> = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '🌨', 75: '❄️',
  80: '🌧', 81: '🌧', 82: '⛈',
  95: '⛈', 96: '⛈', 99: '⛈',
};
const DAY = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

export function WeatherForecastWidget({ position }: { position?: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const { data, cached } = usePolling(fetchForecast, 30 * 60_000, 'jarvis:forecast');

  return (
    <WidgetShell title="5-Day" position={position} width={220} height={140}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 4 }}>
        {!data && <span style={{ opacity: 0.5, fontSize: '0.55rem' }}>loading…</span>}
        {data?.map((d) => {
          const dt = new Date(d.date + 'T00:00:00');
          return (
            <div key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: '0.55rem' }}>
              <span style={{ color: 'var(--hud-cyan, #00d4ff)' }}>{DAY[dt.getDay()]}</span>
              <span style={{ fontSize: '0.95rem' }}>{ICONS[d.code] ?? '·'}</span>
              <span style={{ color: '#ef4444' }}>{Math.round(d.tmax)}°</span>
              <span style={{ color: '#67e8f9', opacity: 0.7 }}>{Math.round(d.tmin)}°</span>
            </div>
          );
        })}
      </div>
      {cached && <div style={{ fontSize: '0.5rem', opacity: 0.5 }}>⚠ cached</div>}
    </WidgetShell>
  );
}
