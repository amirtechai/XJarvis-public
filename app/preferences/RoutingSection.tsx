'use client';

import { useCallback, useEffect, useState } from 'react';
import { useJarvis } from '../../providers/JarvisProvider';

interface ModelRule {
  pattern: string;
  model: string;
  flags?: string;
}
interface Server {
  name: string;
  host: string;
  user: string;
  port?: number;
  keyPath?: string;
}

export function RoutingSection() {
  const { sendRaw, onRawMessage, connected } = useJarvis();
  const [modelRules, setModelRules] = useState<ModelRule[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [saved, setSaved] = useState(false);

  const handleMessage = useCallback((msg: Record<string, unknown>) => {
    if (msg.type === 'settings') {
      setModelRules((msg.modelRules as ModelRule[]) ?? []);
      setServers((msg.servers as Server[]) ?? []);
      return true;
    }
    if (msg.type === 'settings_saved') {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    }
    return false;
  }, []);

  useEffect(() => onRawMessage(handleMessage), [onRawMessage, handleMessage]);

  useEffect(() => {
    if (!connected) return;
    sendRaw({ type: 'get_settings' });
  }, [connected, sendRaw]);

  const saveAll = () => {
    sendRaw({ type: 'save_model_rules', rules: modelRules });
    sendRaw({ type: 'save_servers', servers });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Regex routing rules */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: '0.7rem', letterSpacing: '0.15em', opacity: 0.6 }}>REGEX MODEL RULES</div>
        <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>
          Mesaj pattern'e uyarsa Ollama yedek modeline yönlendir (XJarvis offline'ken).
        </div>
        {modelRules.map((rule, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={rule.pattern}
              onChange={(e) => setModelRules((prev) => prev.map((r, idx) => idx === i ? { ...r, pattern: e.target.value } : r))}
              placeholder="regex pattern"
              style={{ ...inputStyle, flex: 2 }}
            />
            <span style={{ opacity: 0.5 }}>→</span>
            <input
              value={rule.model}
              onChange={(e) => setModelRules((prev) => prev.map((r, idx) => idx === i ? { ...r, model: e.target.value } : r))}
              placeholder="model"
              style={{ ...inputStyle, flex: 2 }}
            />
            <button
              onClick={() => setModelRules((prev) => prev.filter((_, idx) => idx !== i))}
              style={iconBtn}
            >×</button>
          </div>
        ))}
        <button
          onClick={() => setModelRules((prev) => [...prev, { pattern: '', model: '', flags: 'i' }])}
          style={ghostBtn}
        >
          + Kural ekle
        </button>
      </div>

      {/* SSH servers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: '0.7rem', letterSpacing: '0.15em', opacity: 0.6 }}>SSH SUNUCULARI</div>
        <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>
          remote_action ile uzak komut çalıştırma için tanımlı sunucular.
        </div>
        {servers.map((server, i) => (
          <div key={i} style={cardStyle}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={server.name} onChange={(e) => setServers((prev) => prev.map((s, idx) => idx === i ? { ...s, name: e.target.value } : s))} placeholder="ad" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => setServers((prev) => prev.filter((_, idx) => idx !== i))} style={iconBtn}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 80px', gap: 6, alignItems: 'center' }}>
              <input value={server.host} onChange={(e) => setServers((prev) => prev.map((s, idx) => idx === i ? { ...s, host: e.target.value } : s))} placeholder="host" style={inputStyle} />
              <span style={{ opacity: 0.5 }}>:</span>
              <input value={String(server.port ?? 22)} onChange={(e) => setServers((prev) => prev.map((s, idx) => idx === i ? { ...s, port: parseInt(e.target.value, 10) || 22 } : s))} placeholder="port" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <input value={server.user} onChange={(e) => setServers((prev) => prev.map((s, idx) => idx === i ? { ...s, user: e.target.value } : s))} placeholder="user" style={inputStyle} />
              <input value={server.keyPath ?? ''} onChange={(e) => setServers((prev) => prev.map((s, idx) => idx === i ? { ...s, keyPath: e.target.value } : s))} placeholder="~/.ssh/id_ed25519" style={inputStyle} />
            </div>
          </div>
        ))}
        <button
          onClick={() => setServers((prev) => [...prev, { name: '', host: '', user: '', port: 22, keyPath: '~/.ssh/id_ed25519' }])}
          style={ghostBtn}
        >
          + Sunucu ekle
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {saved && <span style={{ fontSize: '0.75rem', color: '#34d399' }}>✓ kaydedildi</span>}
        <button onClick={saveAll} style={primaryBtn}>Kaydet (rules + ssh)</button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(var(--hud-rgb),0.3)',
  color: '#fff',
  padding: '0.4rem 0.7rem',
  borderRadius: 6,
  fontSize: '0.8rem',
  fontFamily: 'monospace',
};
const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(var(--hud-rgb),0.15)',
  borderRadius: 8,
  padding: '0.7rem 0.85rem',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--hud-cyan, #00d4ff)',
  border: '1px dashed rgba(var(--hud-rgb),0.3)',
  padding: '0.4rem 0.85rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.75rem',
  alignSelf: 'flex-start',
};
const primaryBtn: React.CSSProperties = {
  background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
  color: '#001a26',
  border: 'none',
  padding: '0.5rem 1.2rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.82rem',
};
const iconBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#ef4444',
  cursor: 'pointer',
  fontSize: '1.1rem',
  padding: '0 4px',
};
