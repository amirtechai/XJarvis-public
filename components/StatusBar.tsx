import type { VoiceState } from '../hooks/useVoice';

interface Props {
  connected: boolean;
  model: string;
  voiceState: VoiceState;
}

export function StatusBar({ connected, model, voiceState }: Props) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      padding: '6px 16px',
      gap: 10,
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-surface)',
      flexShrink: 0,
    }}>
      {model && (
        <span style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          background: 'var(--bg-elevated)',
          padding: '2px 8px',
          borderRadius: 5,
          fontFamily: 'ui-monospace, monospace',
        }}>
          {model}
        </span>
      )}

      {voiceState !== 'idle' && (
        <span style={{ fontSize: 11, color: 'var(--accent)' }}>
          {voiceState === 'listening' ? '🎙 Dinliyorum' : '🔊 Konuşuyorum'}
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: connected ? 'var(--success)' : 'var(--danger)',
          boxShadow: connected ? '0 0 5px var(--success)' : 'none',
        }} />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {connected ? 'online' : 'offline'}
        </span>
      </div>
    </div>
  );
}
