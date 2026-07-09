'use client';
import { useEffect } from 'react';

/**
 * Global viewport scaler.
 *
 * The HUD is designed for a 1920×1080 canvas; on smaller windows fixed-
 * position layouts otherwise clip. We apply CSS `zoom` on the document
 * root so every element — including position:fixed bars like StatusHud
 * and the dashboard widgets — scales uniformly.
 *
 * `zoom` is fully supported in WebKit/Chromium (and Firefox ≥126), which
 * covers the Tauri shell and any modern browser this app runs in.
 */
const BASE_W = 1920;
const BASE_H = 1080;
const MIN_ZOOM = 0.55;

export function HudScale() {
  useEffect(() => {
    // Mobile / remote host → don't shrink everything; the page should
    // render at its natural mobile size.
    const host = window.location.hostname;
    const isRemote = host !== 'localhost' && host !== '127.0.0.1' && host !== 'tauri.localhost';

    const recompute = () => {
      if (isRemote || window.innerWidth < 900) {
        (document.documentElement.style as unknown as { zoom: string }).zoom = '1';
        return;
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const z = Math.max(MIN_ZOOM, Math.min(w / BASE_W, h / BASE_H, 1));
      // `zoom` is non-standard but well-supported and the only way to
      // uniformly scale a fixed-position HUD. Cast to any to satisfy TS.
      (document.documentElement.style as unknown as { zoom: string }).zoom = String(z);
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  return null;
}
