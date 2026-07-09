'use client';

interface Action {
  label: string;
  icon: string;
  key: string;
}

const ACTIONS: Action[] = [
  { label: 'Shell', icon: '⌨️', key: '__shell__' },
  { label: 'Uygulama aç', icon: '📂', key: '__open_app__' },
  { label: 'Web ara', icon: '🔍', key: '__web_search__' },
  { label: 'Jarvis\'e sor', icon: '◈', key: 'jarvis ask ' },
];

interface Props {
  onAction: (key: string) => void;
}

export function ActionPanel({ onAction }: Props) {
  return (
    <div style={{
      display: 'flex',
      gap: 8,
      padding: '8px 16px',
      overflowX: 'auto',
      flexShrink: 0,
    }}>
      {ACTIONS.map((action) => (
        <button
          key={action.key}
          onClick={() => onAction(action.key)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            const btn = e.currentTarget;
            btn.style.color = 'var(--text-primary)';
            btn.style.borderColor = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget;
            btn.style.color = 'var(--text-secondary)';
            btn.style.borderColor = 'var(--border)';
          }}
        >
          <span>{action.icon}</span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}
