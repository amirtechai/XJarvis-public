'use client';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Renders Mac-only HUD chrome (NavBar, StatusHud, BootSequence, etc.)
 * ONLY when the page is being viewed on the local machine.
 *
 * On `xjarvis.your-domain.example` (or any non-localhost host) the chrome is
 * suppressed so the mobile companion view is clean and self-contained.
 */
export function MacShell({ children }: { children: ReactNode }) {
  const [isLocal, setIsLocal] = useState(false);
  useEffect(() => {
    const h = window.location.hostname;
    setIsLocal(h === 'localhost' || h === '127.0.0.1' || h === 'tauri.localhost' || h.endsWith('.tauri.dev'));
  }, []);
  if (!isLocal) return null;
  return <>{children}</>;
}
