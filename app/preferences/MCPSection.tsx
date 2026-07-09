'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface Preset {
  id: string;
  label: string;
  description: string;
  requires_env: string[];
  installed: boolean;
}

interface InstalledMCP {
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

interface MCPStatus {
  alive: boolean;
  last_log: number | null;
  error: string | null;
  started_count: number;
}
interface StatusResp {
  status: Record<string, MCPStatus>;
  agent_running: boolean;
}

export function MCPSection() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [installed, setInstalled] = useState<InstalledMCP['mcpServers']>({});
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [envInputs, setEnvInputs] = useState<Record<string, Record<string, string>>>({});
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({ name: '', command: '', args: '', env: '' });

  const load = async () => {
    try {
      const [a, b, c] = await Promise.all([
        fetch(`${BACKEND}/api/mcp/presets`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`${BACKEND}/api/mcp/installed`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`${BACKEND}/api/mcp/status`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ]);
      setPresets(a.presets || []);
      setInstalled(b.mcpServers || {});
      setStatus(c);
    } finally {
      setLoading(false);
    }
  };

  // Refresh status every 8s while panel is open
  useEffect(() => {
    const t = setInterval(() => {
      fetch(`${BACKEND}/api/mcp/status`, { cache: 'no-store' })
        .then((r) => r.json()).then(setStatus).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, []);

  const addCustom = async () => {
    const name = custom.name.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      alert('İsim sadece a-z, 0-9, - veya _ içerebilir.');
      return;
    }
    let args: string[] = [];
    try {
      args = custom.args.trim() ? JSON.parse(custom.args) : [];
      if (!Array.isArray(args)) throw new Error('args must be array');
    } catch (e) {
      alert(`args geçersiz JSON array: ${e}`);
      return;
    }
    let env: Record<string, string> = {};
    try {
      env = custom.env.trim() ? JSON.parse(custom.env) : {};
    } catch (e) {
      alert(`env geçersiz JSON object: ${e}`);
      return;
    }
    setBusy(name);
    try {
      const r = await fetch(`${BACKEND}/api/mcp/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, command: custom.command, args, env }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        alert(j.error || 'failed');
        return;
      }
      setCustom({ name: '', command: '', args: '', env: '' });
      setShowCustom(false);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const uninstallByName = async (name: string) => {
    setBusy(name);
    try {
      await fetch(`${BACKEND}/api/mcp/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: name }),
      });
      await load();
    } finally { setBusy(null); }
  };

  useEffect(() => { load(); }, []);

  const setEnv = (presetId: string, key: string, value: string) => {
    setEnvInputs((prev) => ({
      ...prev,
      [presetId]: { ...(prev[presetId] || {}), [key]: value },
    }));
  };

  const install = async (preset: Preset) => {
    setBusy(preset.id);
    setMsg(null);
    try {
      const env = envInputs[preset.id] || {};
      // Validate required env locally first
      for (const k of preset.requires_env) {
        if (!env[k]) {
          setMsg({ id: preset.id, ok: false, text: `${k} gerekli` });
          return;
        }
      }
      const r = await fetch(`${BACKEND}/api/mcp/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: preset.id, env }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setMsg({ id: preset.id, ok: false, text: j.error || 'install failed' });
        return;
      }
      setMsg({ id: preset.id, ok: true, text: '✓ kuruldu — agent\'ı yeniden başlat' });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async (preset: Preset) => {
    setBusy(preset.id);
    try {
      await fetch(`${BACKEND}/api/mcp/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: preset.id }),
      });
      setMsg({ id: preset.id, ok: true, text: '✓ kaldırıldı — agent\'ı yeniden başlat' });
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div style={{ opacity: 0.6, fontSize: '0.85rem' }}>Yükleniyor…</div>;
  }

  const presetIds = new Set(presets.map((p) => p.id));
  const customInstalled = Object.entries(installed).filter(([id]) => !presetIds.has(id));

  const aliveCount = status ? Object.values(status.status).filter((s) => s.alive).length : 0;
  const totalConfigured = status ? Object.keys(status.status).length : Object.keys(installed).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: '0.75rem', opacity: 0.7, flex: 1 }}>
          MCP server&apos;lar agent&apos;a yeni tool&apos;lar ekler. Kurulumdan sonra agent servisini yeniden başlat (tray → Restart).
        </div>
        <button onClick={() => setShowCustom(!showCustom)} style={ghostBtn}>
          {showCustom ? 'Vazgeç' : '+ Manuel Ekle'}
        </button>
      </div>

      {status && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          padding: '8px 12px', borderRadius: 8,
          background: status.agent_running ? 'rgba(52,211,153,0.06)' : 'rgba(255,80,80,0.08)',
          border: `1px solid ${status.agent_running ? 'rgba(52,211,153,0.35)' : 'rgba(255,80,80,0.4)'}`,
          fontSize: 11, letterSpacing: '0.04em',
        }}>
          <span style={{ color: status.agent_running ? '#34d399' : '#ff8888', fontWeight: 700 }}>
            {status.agent_running ? '● AGENT.SERVICE ÇALIŞIYOR' : '✕ AGENT.SERVICE KAPALI'}
          </span>
          <span style={{ opacity: 0.75 }}>
            · {aliveCount}/{totalConfigured} MCP canlı
          </span>
          {!status.agent_running && (
            <span style={{ opacity: 0.65, fontSize: 10 }}>
              → tray ikonundan agent&apos;ı başlat (yoksa MCP&apos;ler bağlanmaz)
            </span>
          )}
        </div>
      )}

      {showCustom && (
        <div style={{
          padding: '0.85rem 1rem',
          borderRadius: 10,
          background: 'rgba(var(--hud-rgb),0.04)',
          border: '1px solid rgba(var(--hud-rgb),0.25)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: '0.8rem' }}>Custom MCP server</div>
          <input
            placeholder="name (örn: my-server)"
            value={custom.name}
            onChange={(e) => setCustom({ ...custom, name: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="command (örn: npx, uvx, python3)"
            value={custom.command}
            onChange={(e) => setCustom({ ...custom, command: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder='args (JSON array, örn: ["-y", "@scope/pkg"])'
            value={custom.args}
            onChange={(e) => setCustom({ ...custom, args: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder='env (JSON object, opsiyonel, örn: {"KEY":"value"})'
            value={custom.env}
            onChange={(e) => setCustom({ ...custom, env: e.target.value })}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={addCustom} disabled={busy !== null} style={primaryBtn}>
              {busy ? '…' : 'Ekle'}
            </button>
          </div>
        </div>
      )}
      {presets.map((p) => (
        <div
          key={p.id}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: 10,
            background: p.installed ? 'rgba(52,211,153,0.06)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${p.installed ? 'rgba(52,211,153,0.3)' : 'rgba(var(--hud-rgb),0.15)'}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '0.95rem', flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
              {p.installed && <span style={{ color: '#34d399' }}>✓</span>}
              {p.label}
              {p.installed && status?.status[p.id] && (
                <span
                  title={status.status[p.id].error || (status.status[p.id].alive ? 'canlı' : 'log eski / process down')}
                  style={{
                    fontSize: 9, padding: '2px 7px', borderRadius: 10,
                    background: status.status[p.id].alive ? 'rgba(52,211,153,0.18)' : 'rgba(255,140,80,0.12)',
                    border: `1px solid ${status.status[p.id].alive ? 'rgba(52,211,153,0.5)' : 'rgba(255,140,80,0.4)'}`,
                    color: status.status[p.id].alive ? '#34d399' : '#ffaa66',
                    letterSpacing: '0.12em', fontWeight: 700,
                  }}
                >
                  {status.status[p.id].alive ? '● LIVE' : '○ IDLE'}
                </span>
              )}
            </span>
            {p.installed ? (
              <button onClick={() => uninstall(p)} disabled={busy === p.id} style={dangerBtn}>
                {busy === p.id ? '…' : 'Kaldır'}
              </button>
            ) : (
              <button onClick={() => install(p)} disabled={busy === p.id} style={primaryBtn}>
                {busy === p.id ? '…' : 'Kur'}
              </button>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{p.description}</div>
          {!p.installed && p.requires_env.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {p.requires_env.map((k) => (
                <input
                  key={k}
                  type="password"
                  placeholder={k}
                  value={envInputs[p.id]?.[k] ?? ''}
                  onChange={(e) => setEnv(p.id, k, e.target.value)}
                  style={inputStyle}
                />
              ))}
            </div>
          )}
          {msg?.id === p.id && (
            <div style={{ fontSize: '0.75rem', color: msg.ok ? '#34d399' : '#ef4444' }}>
              {msg.text}
            </div>
          )}
        </div>
      ))}

      {customInstalled.length > 0 && (
        <>
          <div style={{ fontSize: '0.7rem', letterSpacing: '0.15em', opacity: 0.5, marginTop: 8 }}>
            CUSTOM SERVERS
          </div>
          {customInstalled.map(([id, cfg]) => (
            <div
              key={id}
              style={{
                padding: '0.6rem 0.85rem',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem',
              }}
            >
              <span style={{ flex: 1, fontFamily: 'monospace' }}>
                {id} <span style={{ opacity: 0.5 }}>· {cfg.command} {(cfg.args || []).join(' ')}</span>
              </span>
              <button onClick={() => uninstallByName(id)} disabled={busy === id} style={dangerBtn}>
                {busy === id ? '…' : 'Sil'}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--hud-cyan, #00d4ff)',
  border: '1px solid rgba(var(--hud-rgb),0.4)',
  padding: '0.4rem 0.8rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.78rem',
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(var(--hud-rgb),0.3)',
  color: '#fff',
  padding: '0.5rem 0.75rem',
  borderRadius: 6,
  fontSize: '0.8rem',
  fontFamily: 'monospace',
};
const primaryBtn: React.CSSProperties = {
  background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
  color: '#001a26',
  border: 'none',
  padding: '0.4rem 1rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.8rem',
};
const dangerBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#ef4444',
  border: '1px solid rgba(239,68,68,0.4)',
  padding: '0.4rem 1rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.8rem',
};
