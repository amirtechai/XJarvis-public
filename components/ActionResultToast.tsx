'use client';
import { useEffect, useState } from 'react';
import type { ActionResult } from '../hooks/useActions';

interface Props {
  result: ActionResult | null;
  error: string | null;
}

export function ActionResultToast({ result, error }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (result || error) {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 6000);
      return () => clearTimeout(t);
    }
  }, [result, error]);

  if (!visible || (!result && !error)) return null;

  const isError = !!error || (result && result.exitCode !== 0);
  const output = error ?? (result ? (result.stdout || result.stderr || 'Done') : '');

  return (
    <div style={{
      position: 'fixed',
      bottom: 90,
      right: 20,
      maxWidth: 400,
      background: 'var(--bg-elevated)',
      border: `1px solid ${isError ? 'var(--danger)' : 'var(--success)'}`,
      borderRadius: 10,
      padding: '10px 14px',
      zIndex: 50,
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    }}>
      <div style={{
        fontSize: 12,
        color: isError ? 'var(--danger)' : 'var(--success)',
        fontWeight: 600,
        marginBottom: 4,
      }}>
        {isError ? '✗ Hata' : '✓ Tamamlandı'}
        {result?.action && (
          <span style={{ color: 'var(--text-secondary)', fontWeight: 400, marginLeft: 6 }}>
            {result.action}
          </span>
        )}
      </div>
      <pre style={{
        fontFamily: 'monospace',
        fontSize: 12,
        color: 'var(--text-primary)',
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        maxHeight: 160,
        overflow: 'auto',
      }}>
        {output}
      </pre>
    </div>
  );
}
