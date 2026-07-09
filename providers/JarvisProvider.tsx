'use client';
import { createContext, useContext } from 'react';
import { useJarvisSocket, type JarvisSocketState } from '../hooks/useJarvisSocket';

const JarvisContext = createContext<JarvisSocketState | null>(null);

export function JarvisProvider({ children }: { children: React.ReactNode }) {
  const socket = useJarvisSocket();
  return <JarvisContext.Provider value={socket}>{children}</JarvisContext.Provider>;
}

export function useJarvis(): JarvisSocketState {
  const ctx = useContext(JarvisContext);
  if (!ctx) throw new Error('useJarvis must be used within JarvisProvider');
  return ctx;
}
