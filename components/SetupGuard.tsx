'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

import { BACKEND } from '@/lib/backend';
const SKIP_PATHS = ['/onboarding', '/preferences', '/settings', '/dictation'];

/**
 * Mounts once at app root. If backend reports `setup_complete: false` and the
 * user isn't already on /onboarding (or a settings page), bounces them there.
 */
export function SetupGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    if (SKIP_PATHS.includes(pathname)) {
      checked.current = true;
      return;
    }
    let alive = true;
    fetch(`${BACKEND}/api/setup/status`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        checked.current = true;
        if (data && data.setup_complete === false) {
          router.replace('/onboarding');
        }
      })
      .catch(() => {
        if (alive) checked.current = true;
      });
    return () => { alive = false; };
  }, [pathname, router]);

  return null;
}
