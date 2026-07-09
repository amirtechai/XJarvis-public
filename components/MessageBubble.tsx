import type { ChatMessage } from '../hooks/useJarvisSocket';

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === 'user';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
      padding: '0 16px',
    }}>
      <div style={{
        maxWidth: '75%',
        padding: '10px 14px',
        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        background: isUser ? 'var(--accent)' : 'var(--bg-elevated)',
        color: 'var(--text-primary)',
        fontSize: 14,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        <span className={isStreaming && !isUser ? 'streaming-cursor' : ''}>
          {message.content}
        </span>
        {message.model && !isUser && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            {message.model}
          </div>
        )}
      </div>
    </div>
  );
}
