'use client';
import { useCallback, useEffect, useState } from 'react';
import { useJarvis } from '../../providers/JarvisProvider';
import { ConnectorCard } from '../../components/ConnectorCard';
import type { ConnectorInfo } from '../../components/ConnectorCard';

export default function ConnectorsPage() {
  const { sendRaw, onRawMessage, connected } = useJarvis();
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'connected' | 'disconnected'>('all');

  const handleMessage = useCallback((msg: Record<string, unknown>) => {
    if (msg.type === 'connectors') {
      setConnectors((msg.connectors as ConnectorInfo[]) ?? []);
      setLoading(false);
      return true;
    }
    if (msg.type === 'connector_synced' || msg.type === 'connector_sync_error') {
      // Refresh connector list after sync completes
      sendRaw({ type: 'get_connectors' });
      return true;
    }
    return false;
  }, [sendRaw]);

  useEffect(() => {
    return onRawMessage(handleMessage);
  }, [onRawMessage, handleMessage]);

  useEffect(() => {
    if (!connected) return;
    setLoading(true);
    sendRaw({ type: 'get_connectors' });
  }, [connected, sendRaw]);

  const handleSync = useCallback((name: string) => {
    sendRaw({ type: 'sync_connector', name });
  }, [sendRaw]);

  const filtered = connectors.filter((c) => {
    if (filter === 'connected') return c.connected;
    if (filter === 'disconnected') return !c.connected;
    return true;
  });

  const connectedCount = connectors.filter((c) => c.connected).length;

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>
            Connectors
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            {connectedCount}/{connectors.length} bağlı
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'connected', 'disconnected'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 12px',
                borderRadius: 7,
                border: '1px solid var(--border)',
                background: filter === f ? 'var(--bg-elevated)' : 'transparent',
                color: filter === f ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {f === 'all' ? 'Tümü' : f === 'connected' ? 'Bağlı' : 'Bağlı değil'}
            </button>
          ))}
          <button
            onClick={() => { setLoading(true); sendRaw({ type: 'get_connectors' }); }}
            style={{
              padding: '5px 12px',
              borderRadius: 7,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--accent)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            ↻ Yenile
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
          Connector durumları yükleniyor…
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 12,
        }}>
          {filtered.map((c) => (
            <ConnectorCard key={c.name} connector={c} onSync={handleSync} />
          ))}
        </div>
      )}
    </div>
  );
}
