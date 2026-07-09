'use client';
import { WidgetShell } from './WidgetShell';
import { usePolling } from '@/hooks/usePolling';

interface WeatherData {
  temp: number;
  humidity: number;
  wind: number;
  code: number;
  hourly: { time: string; temp: number }[];
}

const ICON: Record<number, string> = {
  0: '☀', 1: '🌤', 2: '⛅', 3: '☁', 45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌦',
  61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '🌨', 75: '🌨',
  80: '🌦', 81: '🌧', 82: '⛈',
  95: '⛈', 96: '⛈', 99: '⛈',
};

async function fetchWeather(): Promise<WeatherData> {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&hourly=temperature_2m&forecast_days=1&timezone=Europe%2FIstanbul';
  const r = await fetch(url);
  if (!r.ok) throw new Error('weather fetch failed');
  const d = await r.json();
  const now = new Date();
  const hourIdx = d.hourly.time.findIndex((t: string) => new Date(t).getHours() === now.getHours());
  const slice = hourIdx >= 0 ? d.hourly.time.slice(hourIdx, hourIdx + 5) : d.hourly.time.slice(0, 5);
  const temps = hourIdx >= 0 ? d.hourly.temperature_2m.slice(hourIdx, hourIdx + 5) : d.hourly.temperature_2m.slice(0, 5);
  return {
    temp: d.current.temperature_2m,
    humidity: d.current.relative_humidity_2m,
    wind: d.current.wind_speed_10m,
    code: d.current.weather_code,
    hourly: slice.map((t: string, i: number) => ({ time: t.slice(11, 13), temp: temps[i] })),
  };
}

export function WeatherWidget({ position }: { position: { top?: string; bottom?: string; left?: string; right?: string } }) {
  const { data } = usePolling(fetchWeather, 600_000, 'jarvis:weather');

  return (
    <WidgetShell title="Balıkesir" position={position}>
      {data ? (
        <>
          <div style={{ fontSize: '1rem' }}>{ICON[data.code] ?? '·'} {data.temp.toFixed(0)}°C</div>
          <div style={{ fontSize: '0.55rem', opacity: 0.7 }}>{data.humidity}% · {data.wind.toFixed(0)} km/h</div>
          <div style={{ display: 'flex', gap: '0.3rem', fontSize: '0.5rem', marginTop: '0.3rem' }}>
            {data.hourly.map((h) => (
              <div key={h.time} style={{ textAlign: 'center', opacity: 0.8 }}>
                <div>{h.time}</div>
                <div>{h.temp.toFixed(0)}°</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <span style={{ opacity: 0.5 }}>…</span>
      )}
    </WidgetShell>
  );
}
