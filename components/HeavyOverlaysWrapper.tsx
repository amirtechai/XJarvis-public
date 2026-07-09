'use client';

import dynamic from 'next/dynamic';

const ParticleBurst = dynamic(() => import('./ParticleBurst').then(m => ({ default: m.ParticleBurst })), { ssr: false });
const CrtOverlay = dynamic(() => import('./CrtOverlay').then(m => ({ default: m.CrtOverlay })), { ssr: false });
const HandGesture = dynamic(() => import('./HandGesture').then(m => ({ default: m.HandGesture })), { ssr: false });

export function HeavyOverlaysWrapper() {
  return (
    <>
      <ParticleBurst />
      <CrtOverlay />
      <HandGesture />
    </>
  );
}
