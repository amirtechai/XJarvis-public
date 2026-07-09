'use client';
import { useEffect, useState } from 'react';

interface ServiceState { name: string; running: boolean }
interface ControlState { mic?: { on?: boolean }; camera?: { on?: boolean }; volume?: number; jarvis?: { on?: boolean } }

import { BACKEND } from '@/lib/backend';

export function StatusHud() {
  const [services, setServices] = useState<ServiceState[]>([]);
  const [ctl, setCtl] = useState<ControlState>({});
  const [model, setModel] = useState<string>('—');
  const [now, setNow] = useState<string>('');
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const poll = () => {
      Promise.all([
        fetch(`${BACKEND}/api/services/state`).then((r) => r.json()).catch(() => null),
        fetch(`${BACKEND}/api/control/state`).then((r) => r.json()).catch(() => null),
        fetch(`${BACKEND}/api/agent/model`).then((r) => r.json()).catch(() => null),
        fetch(`${BACKEND}/api/health`).then((r) => r.json()).catch(() => null),
      ]).then(([svc, c, m, h]) => {
        if (svc?.services) setServices(svc.services);
        if (c) setCtl(c);
        if (m?.model) setModel(m.model);
        if (h && typeof h.latency_ms === 'number') setLatency(h.latency_ms);
      });
    };
    poll(); const id = setInterval(poll, 4000); return () => clearInterval(id);
  }, []);

  const dot = (ok: boolean) => (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      background: ok ? '#00ff88' : '#ff006e',
      boxShadow: ok ? '0 0 6px #00ff88' : '0 0 6px #ff006e',
      marginRight: 4,
    }} />
  );

  const Item = ({ children, dim = false, onClick, title }: {
    children: React.ReactNode; dim?: boolean; onClick?: () => void; title?: string;
  }) => (
    <span
      title={title}
      onClick={onClick}
      style={{
        opacity: dim ? 0.5 : 0.85,
        padding: '0 10px',
        borderRight: '1px solid var(--glass-border)',
        cursor: onClick ? 'pointer' : 'default',
        pointerEvents: onClick ? 'auto' : 'none',
        transition: 'background 120ms ease, color 120ms ease',
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = 'rgba(0, 217, 255, 0.1)'; }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </span>
  );

  const toggleService = async (name: string, running: boolean) => {
    const path = running ? '/api/services/stop' : '/api/services/start';
    if (running && !confirm(`${name.toUpperCase()} servisini durdur?`)) return;
    try {
      await fetch(`${BACKEND}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      // Refresh state immediately
      const r = await fetch(`${BACKEND}/api/services/state`).then((res) => res.json()).catch(() => null);
      if (r?.services) setServices(r.services);
    } catch { /* noop */ }
  };

  const toggleControl = async (name: 'mic' | 'camera' | 'jarvis') => {
    try {
      await fetch(`${BACKEND}/api/control/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const r = await fetch(`${BACKEND}/api/control/state`).then((res) => res.json()).catch(() => null);
      if (r) setCtl(r);
    } catch { /* noop */ }
  };

  return (
    <div
      className="hud-glass-new"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: 22, lineHeight: '22px',
        padding: '0 10px',
        borderTop: '1px solid var(--glass-border)',
        color: '#00d9ff',
        fontFamily: 'var(--font-stack)',
        fontSize: 10, letterSpacing: '0.18em',
        display: 'flex', alignItems: 'center',
        zIndex: 80,
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
      }}
    >
      {services.map((s) => (
        <Item
          key={s.name}
          title={s.running ? `Click to stop ${s.name}` : `Click to start ${s.name}`}
          onClick={s.name === 'backend' || s.name === 'ui' ? undefined : () => toggleService(s.name, s.running)}
        >{dot(s.running)}{s.name.toUpperCase()}</Item>
      ))}
      <Item title="Toggle microphone" onClick={() => toggleControl('mic')}>{dot(!!ctl.mic?.on)}MIC</Item>
      <Item title="Toggle camera" onClick={() => toggleControl('camera')}>{dot(!!ctl.camera?.on)}CAM</Item>
      <Item title="Toggle XJarvis" dim={!ctl.jarvis?.on} onClick={() => toggleControl('jarvis')}>{dot(!!ctl.jarvis?.on)}JARVIS</Item>
      {typeof ctl.volume === 'number' && <Item>VOL {ctl.volume}</Item>}
      <Item>{model.split('/').pop()}</Item>
      {latency !== null && <Item>LAT {latency}ms</Item>}
      <span style={{ flex: 1 }} />
      <span style={{ opacity: 0.8, padding: '0 6px', color: '#9fb3c8' }}>{now}</span>
    </div>
  );
}
