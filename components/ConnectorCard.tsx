'use client';

export interface ConnectorInfo {
  name: string;
  icon: string;
  connected: boolean;
  state: string;
  items_synced: number;
  items_total: number;
  last_sync: string | null;
  error: string | null;
}

interface Props {
  connector: ConnectorInfo;
  onSync: (name: string) => void;
}

export function ConnectorCard({ connector, onSync }: Props) {
  const { name, icon, connected, state, items_synced, last_sync, error } = connector;
  const isSyncing = state === 'syncing';
  const hasError = state === 'error' || !!error;

  const statusColor = hasError
    ? 'var(--danger)'
    : connected
    ? 'var(--success)'
    : 'var(--text-secondary)';

  const lastSyncLabel = last_sync
    ? new Date(last_sync).toLocaleString('tr-TR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Hiç sync edilmedi';

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: `1px solid ${hasError ? 'var(--danger)33' : connected ? 'var(--success)22' : 'var(--border)'}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: statusColor,
            boxShadow: connected && !hasError ? `0 0 6px ${statusColor}` : 'none',
          }} />
          <span style={{ fontSize: 11, color: statusColor }}>
            {isSyncing ? 'Syncing…' : hasError ? 'Error' : connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: 'var(--danger)', background: 'var(--danger)11', borderRadius: 5, padding: '4px 8px' }}>
          {error.length > 80 ? error.slice(0, 80) + '…' : error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {items_synced > 0 ? `${items_synced.toLocaleString()} item` : lastSyncLabel}
        </div>
        <button
          onClick={() => onSync(name)}
          disabled={isSyncing}
          style={{
            padding: '3px 10px',
            borderRadius: 5,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: isSyncing ? 'var(--text-secondary)' : 'var(--accent)',
            fontSize: 11,
            cursor: isSyncing ? 'default' : 'pointer',
          }}
        >
          {isSyncing ? '…' : 'Sync'}
        </button>
      </div>
    </div>
  );
}
