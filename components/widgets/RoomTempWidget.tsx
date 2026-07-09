'use client';
import { useState } from 'react';
import { WidgetShell } from './WidgetShell';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';

export function RoomTempWidget({ position }: { position: { top?: string; left?: string } }) {
  const [unit, setUnit] = useState<'C' | 'F'>('C');
  const [manualTemp, setManualTemp] = useState<number | null>(null);
  const [manualHumidity, setManualHumidity] = useState<number | null>(null);

  // Future: a sensor sidecar can emit WEATHER_UPDATE with source='room'
  const { lastEvent } = useJarvisEvents([EVENT_TYPES.WEATHER_UPDATE]);

  let temp = manualTemp;
  let humidity = manualHumidity;
  if (lastEvent?.source === 'system' && (lastEvent.payload as Record<string, unknown>).room) {
    const p = lastEvent.payload as { room?: { temp?: number; humidity?: number } };
    if (p.room?.temp != null) temp = p.room.temp;
    if (p.room?.humidity != null) humidity = p.room.humidity;
  }

  const display = temp != null
    ? unit === 'C' ? temp.toFixed(1) : (temp * 9 / 5 + 32).toFixed(1)
    : '—';

  return (
    <WidgetShell title="Room" position={position}>
      <div style={{ fontSize: '1.1rem' }}>{display}°{unit}</div>
      <div style={{ fontSize: '0.55rem', opacity: 0.7 }}>
        {humidity != null ? `${humidity.toFixed(0)}% RH` : 'no sensor'}
      </div>
      <div style={{ display: 'flex', gap: '0.2rem', marginTop: '0.3rem', fontSize: '0.5rem' }}>
        <button
          type="button"
          onClick={() => setUnit(unit === 'C' ? 'F' : 'C')}
          style={{ background: 'transparent', border: '1px solid var(--hud-cyan-dim)', color: 'var(--hud-cyan)', padding: '1px 4px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          °{unit === 'C' ? 'F' : 'C'}
        </button>
        <button
          type="button"
          onClick={() => {
            const v = window.prompt('Manuel sıcaklık (°C)');
            if (v != null) {
              const n = parseFloat(v);
              if (!Number.isNaN(n)) setManualTemp(n);
            }
            const h = window.prompt('Nem (%)');
            if (h != null) {
              const n = parseFloat(h);
              if (!Number.isNaN(n)) setManualHumidity(n);
            }
          }}
          style={{ background: 'transparent', border: '1px solid var(--hud-cyan-dim)', color: 'var(--hud-cyan)', padding: '1px 4px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          set
        </button>
      </div>
    </WidgetShell>
  );
}
