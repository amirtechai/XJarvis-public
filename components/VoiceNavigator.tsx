'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';

/**
 * Sesli komutlar (örn. "haberler") backend voice-router üzerinden NAVIGATE
 * event'i atar — bu component event'i dinleyip Next router ile gezintiyi yapar.
 */
export function VoiceNavigator() {
  const router = useRouter();
  const { lastEvent } = useJarvisEvents([EVENT_TYPES.NAVIGATE, EVENT_TYPES.SERVICE_HEALTH_CHANGE]);

  useEffect(() => {
    if (!lastEvent) return;
    let path: string | undefined;
    if (lastEvent.event === EVENT_TYPES.NAVIGATE) {
      // Backend nav broadcasts use `route`; legacy voice router used `path`.
      const p = lastEvent.payload as { path?: string; route?: string };
      path = p?.route ?? p?.path;
    } else if (lastEvent.event === EVENT_TYPES.SERVICE_HEALTH_CHANGE) {
      const p = lastEvent.payload as { service?: string; status?: string };
      if (p?.service === 'navigate' && typeof p.status === 'string' && p.status.startsWith('/')) {
        path = p.status;
      }
    }
    if (path) {
      router.push(path);
    }
  }, [lastEvent, router]);

  return null;
}
