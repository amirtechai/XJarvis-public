'use client';
import type { CSSProperties, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode, Ref } from 'react';

const baseStyle: CSSProperties = {
  width: '100%',
  background: 'rgba(0,8,20,0.6)',
  border: '1px solid rgba(var(--hud-rgb),0.18)',
  borderRadius: 6,
  padding: '8px 12px',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: 'inherit',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
  outline: 'none',
};

function applyFocus(e: React.FocusEvent<HTMLElement>) {
  (e.currentTarget as HTMLElement).style.borderColor = 'rgba(var(--hud-rgb),0.55)';
  (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(var(--hud-rgb),0.08)';
}
function removeFocus(e: React.FocusEvent<HTMLElement>) {
  (e.currentTarget as HTMLElement).style.borderColor = 'rgba(var(--hud-rgb),0.18)';
  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
}

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      {label && (
        <div className="hud-font" style={{
          fontSize: 10, letterSpacing: '0.18em', color: 'rgba(var(--hud-rgb),0.7)',
          marginBottom: 5, textTransform: 'uppercase',
        }}>
          {label}
        </div>
      )}
      {children}
      {hint && !error && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{hint}</div>}
      {error && <div style={{ fontSize: 11, color: 'var(--hud-red)', marginTop: 4 }}>{error}</div>}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> { ref?: Ref<HTMLInputElement> }
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { ref?: Ref<HTMLTextAreaElement> }
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { ref?: Ref<HTMLSelectElement> }

export function Input({ style, onFocus, onBlur, ref, ...rest }: InputProps) {
  return (
    <input
      ref={ref}
      {...rest}
      style={{ ...baseStyle, ...style }}
      onFocus={(e) => { applyFocus(e); onFocus?.(e); }}
      onBlur={(e) => { removeFocus(e); onBlur?.(e); }}
    />
  );
}

export function Textarea({ style, onFocus, onBlur, ref, ...rest }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      {...rest}
      style={{ ...baseStyle, minHeight: 80, resize: 'vertical', ...style }}
      onFocus={(e) => { applyFocus(e); onFocus?.(e); }}
      onBlur={(e) => { removeFocus(e); onBlur?.(e); }}
    />
  );
}

export function Select({ style, onFocus, onBlur, ref, ...rest }: SelectProps) {
  return (
    <select
      ref={ref}
      {...rest}
      style={{ ...baseStyle, cursor: 'pointer', ...style }}
      onFocus={(e) => { applyFocus(e); onFocus?.(e); }}
      onBlur={(e) => { removeFocus(e); onBlur?.(e); }}
    />
  );
}
