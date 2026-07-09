import type { Metadata } from 'next';
import { Orbitron } from 'next/font/google';
import './globals.css';
import { NavBar } from '../components/NavBar';
import { CommandPalette } from '../components/CommandPalette';
import { ApprovalBanner } from '../components/ApprovalBanner';
import { StandbyMode } from '../components/StandbyMode';
import { PermissionPrimer } from '../components/PermissionPrimer';
import { HeavyOverlaysWrapper } from '../components/HeavyOverlaysWrapper';
import { JarvisProvider } from '../providers/JarvisProvider';
import { SetupGuard } from '../components/SetupGuard';
import { ToastProvider } from '../components/ui/Toast';
import { VoiceNavigator } from '../components/VoiceNavigator';
import { ThemeBootstrap } from '../hooks/useTheme';
import { StatusHud } from '../components/StatusHud';
import { BootSequence } from '../components/BootSequence';
import { LiveCaption } from '../components/LiveCaption';
import { HudScale } from '../components/HudScale';
import { MacShell } from '../components/MacShell';
import { VideoBackground } from '../components/VideoBackground';
import { ChromeGate } from '../components/ChromeGate';

const orbitron = Orbitron({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-orbitron',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'XJarvis',
  description: 'Voice-controlled superagent for macOS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={orbitron.variable}>
      <head>
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
        <meta name="theme-color" content="#02060d" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body style={{ background: 'var(--bg-base)', minHeight: '100vh', display: 'flex', flexDirection: 'column', margin: 0 }}>
        <ChromeGate><VideoBackground /></ChromeGate>
        <JarvisProvider>
          <ToastProvider>
          <HudScale />
          <ThemeBootstrap />
          <ChromeGate>
            <MacShell>
              <SetupGuard />
              <VoiceNavigator />
              <NavBar />
              <CommandPalette />
              <ApprovalBanner />
              <StandbyMode />
              <HeavyOverlaysWrapper />
              <PermissionPrimer />
            </MacShell>
          </ChromeGate>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0 }}>
            {children}
          </div>
          <ChromeGate>
            <MacShell>
              <LiveCaption />
              <StatusHud />
              <BootSequence />
            </MacShell>
          </ChromeGate>
          </ToastProvider>
        </JarvisProvider>
      </body>
    </html>
  );
}
