'use client';

interface Props {
  payload: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ActionConfirmDialog({ payload, onConfirm, onCancel }: Props) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
    }}>
      <div style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '24px 28px',
        maxWidth: 440,
        width: '90%',
      }}>
        <div style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
          ⚠ Onay gerekli
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
          Bu komut çalıştırılacak:
        </div>
        <code style={{
          display: 'block',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 12px',
          fontFamily: 'monospace',
          fontSize: 13,
          color: 'var(--text-primary)',
          wordBreak: 'break-all',
          marginBottom: 20,
        }}>
          {payload}
        </code>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '7px 18px',
              borderRadius: 7,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            İptal
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '7px 18px',
              borderRadius: 7,
              border: '1px solid var(--danger)',
              background: 'var(--danger)',
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Çalıştır
          </button>
        </div>
      </div>
    </div>
  );
}
