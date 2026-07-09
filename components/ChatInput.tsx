'use client';
import { useState, useCallback, type KeyboardEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  onVoiceToggle: () => void;
  disabled: boolean;
  voiceActive: boolean;
}

export function ChatInput({ onSend, onVoiceToggle, disabled, voiceActive }: Props) {
  const [value, setValue] = useState('');

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  }, [value, disabled, onSend]);

  const handleKey = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }, [submit]);

  const canSend = !disabled && value.trim().length > 0;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      padding: '12px 16px',
      background: 'var(--bg-surface)',
      borderTop: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Bir şey sorun... (⌘+Enter gönder)"
        disabled={disabled}
        rows={1}
        style={{
          flex: 1,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '10px 14px',
          color: 'var(--text-primary)',
          fontSize: 14,
          resize: 'none',
          outline: 'none',
          maxHeight: 120,
          lineHeight: 1.5,
          fontFamily: 'inherit',
        }}
      />

      <button
        onClick={onVoiceToggle}
        title={voiceActive ? 'Sesi durdur' : 'Sesle konuş'}
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          border: `1px solid ${voiceActive ? 'var(--accent)' : 'var(--border)'}`,
          background: voiceActive ? 'var(--accent-glow)' : 'var(--bg-elevated)',
          color: voiceActive ? 'var(--accent)' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        🎙️
      </button>

      <button
        onClick={submit}
        disabled={!canSend}
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          border: 'none',
          background: canSend ? 'var(--accent)' : 'var(--bg-elevated)',
          color: canSend ? 'white' : 'var(--text-muted)',
          cursor: canSend ? 'pointer' : 'default',
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 0.15s',
        }}
      >
        ↑
      </button>
    </div>
  );
}
