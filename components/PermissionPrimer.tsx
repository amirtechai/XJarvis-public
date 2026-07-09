'use client';

import { useEffect } from 'react';

const STORAGE_KEY = 'xjarvis:perm-primed';

/**
 * Permission primer — XJarvis ilk açılışta macOS'a mikrofon + kamera izni isteten
 * tetikleyiciyi kullanıcı etkileşimi gerektirmeden bir kez çağırır. Plist'te
 * NSMicrophoneUsageDescription / NSCameraUsageDescription olduğu için OS prompt
 * açar; reddedilse bile bir daha sormaz (System Settings → Privacy üzerinden açılır).
 */
export function PermissionPrimer() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const primed = localStorage.getItem(STORAGE_KEY);
    if (primed === '1') return;

    const ask = async () => {
      try {
        // mic prompt
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        audio.getTracks().forEach((t) => t.stop());
      } catch { /* user can grant later via System Settings */ }
      try {
        // camera prompt — separate dialog
        const video = await navigator.mediaDevices.getUserMedia({ video: true });
        video.getTracks().forEach((t) => t.stop());
      } catch { /* same */ }
      localStorage.setItem(STORAGE_KEY, '1');
    };

    // Wait 1.5s after first paint so the window is visible before the OS dialogs stack up
    const t = setTimeout(ask, 1500);
    return () => clearTimeout(t);
  }, []);

  return null;
}
