import type { VoiceState } from '../hooks/useVoice';

interface Props {
  state: VoiceState;
}

export function VoiceIndicator({ state }: Props) {
  if (state === 'idle') return null;

  const color = state === 'listening' ? 'var(--accent)' : 'var(--success)';
  const label = state === 'listening' ? 'Dinliyorum...' : 'Konuşuyorum...';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      borderRadius: 20,
      background: 'var(--bg-elevated)',
      border: `1px solid ${color}`,
      boxShadow: `0 0 12px ${color}40`,
    }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        animation: 'blink 1s step-start infinite',
      }} />
      <span style={{ fontSize: 13, color }}>{label}</span>
    </div>
  );
}
