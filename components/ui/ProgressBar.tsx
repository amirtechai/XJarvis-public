'use client';

interface Props {
  value: number;        // 0-100
  height?: number;
  color?: string;
  showLabel?: boolean;
}

export function ProgressBar({ value, height = 4, color = 'var(--hud-cyan)', showLabel = false }: Props) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        height, background: 'rgba(var(--hud-rgb),0.12)',
        borderRadius: height / 2, overflow: 'hidden',
      }}>
        <div style={{
          width: `${v}%`, height: '100%',
          background: `linear-gradient(90deg, ${color}, rgba(var(--hud-rgb),0.7))`,
          boxShadow: `0 0 8px ${color}`,
          transition: 'width 360ms ease',
        }} />
      </div>
      {showLabel && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 3 }}>{v}%</div>
      )}
    </div>
  );
}
