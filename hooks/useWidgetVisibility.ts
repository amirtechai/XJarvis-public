'use client';
import { useEffect, useState } from 'react';
import { DEFAULT_HIDDEN } from '@/lib/widget-catalog';

const KEY = 'xjarvis:widgets:hidden';
const EVENT = 'xjarvis:widgets:change';

function loadSet(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set(DEFAULT_HIDDEN);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return new Set(DEFAULT_HIDDEN); // ilk açılış
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}

function saveSet(s: Set<string>) {
  try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* swallow */ }
}

export function useWidgetVisibility() {
  const [hidden, setHidden] = useState<Set<string>>(() => loadSet());

  useEffect(() => {
    const onChange = () => setHidden(loadSet());
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id); else next.add(id);
    saveSet(next);
    setHidden(next);
    window.dispatchEvent(new CustomEvent(EVENT));
  };

  const hide = (id: string) => {
    if (hidden.has(id)) return;
    const next = new Set(hidden);
    next.add(id);
    saveSet(next);
    setHidden(next);
    window.dispatchEvent(new CustomEvent(EVENT));
  };

  return { hidden, toggle, hide };
}
