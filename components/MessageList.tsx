'use client';
import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../hooks/useJarvisSocket';
import { MessageBubble } from './MessageBubble';

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
}

export function MessageList({ messages, streaming }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        gap: 8,
        userSelect: 'none',
      }}>
        <div style={{ fontSize: 40 }}>◈</div>
        <div style={{ fontSize: 15, color: 'var(--text-secondary)' }}>Merhaba. Sizi dinliyorum.</div>
        <div style={{ fontSize: 13 }}>Yazın ya da &quot;Hey Jarvis&quot; deyin</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
      {messages.map((msg, i) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isStreaming={streaming && i === messages.length - 1}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
