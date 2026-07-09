'use client';

/**
 * Global dashboard kabuğunu (NavBar, VideoBackground, StatusHud, MacShell…)
 * sadece normal sayfalarda göster. Floating mini-orb penceresi (/mini-orb)
 * kabuksuz + şeffaf olmalı (sadece avatar + chatbox).
 */
import { usePathname } from 'next/navigation';

const BARE_ROUTES = ['/mini-orb'];

export function ChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  if (BARE_ROUTES.some((r) => pathname.startsWith(r))) return null;
  return <>{children}</>;
}
