'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ClassicDashboard } from '@/components/dashboard/classic/ClassicDashboard';
import { JarvisOrb } from '@/components/orb/JarvisOrb';
import { LiveTalkButton } from '@/components/LiveTalkButton';
import { StereoWaveform } from '@/components/StereoWaveform';
import { CameraFeed } from '@/components/CameraFeed';
import { ClockWidget } from '@/components/widgets/ClockWidget';
import { CryptoForexWidget } from '@/components/widgets/CryptoForexWidget';
import { WeatherWidget } from '@/components/widgets/WeatherWidget';
import { MarketsWidget } from '@/components/widgets/MarketsWidget';
import { SystemHealthWidget } from '@/components/widgets/SystemHealthWidget';
import { BatteryWidget } from '@/components/widgets/BatteryWidget';
import { ActivityLogWidget } from '@/components/widgets/ActivityLogWidget';
import { SystemStatusWidget } from '@/components/widgets/SystemStatusWidget';
import { VoiceTimelineWidget } from '@/components/widgets/VoiceTimelineWidget';
import { LatencyWidget } from '@/components/widgets/LatencyWidget';
import { ControlPanelWidget } from '@/components/widgets/ControlPanelWidget';
import { SubAgentsWidget } from '@/components/widgets/SubAgentsWidget';
import { AgentVoiceWidget } from '@/components/widgets/AgentVoiceWidget';
import { PomodoroWidget } from '@/components/widgets/PomodoroWidget';
import { NowPlayingWidget } from '@/components/widgets/NowPlayingWidget';
import { HealthWidget } from '@/components/widgets/HealthWidget';
import { StockTickerWidget } from '@/components/widgets/StockTickerWidget';
import { DashboardHamburger } from '@/components/dashboard/DashboardHamburger';
import { OrbStyleSwitcher } from '@/components/orb/JarvisOrb';
import { DashboardTopActions } from '@/components/dashboard/DashboardTopActions';
import { useWidgetVisibility } from '@/hooks/useWidgetVisibility';

function Slot({ id, hidden, children, index = 0 }: { id: string; hidden: Set<string>; children: ReactNode; index?: number }) {
  if (hidden.has(id)) return null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        delay: index * 0.05,
        duration: 0.4,
        ease: [0.34, 1.56, 0.64, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

export function DashboardClient() {
  const { hidden } = useWidgetVisibility();
  const [orbMode, setOrbMode] = useState<string | null>(null);
  useEffect(() => { setOrbMode(localStorage.getItem('xjarvis:orbStyle') || 'quantum'); }, []);
  if (orbMode === null) return <div style={{ position: 'fixed', inset: 0, background: '#07080c' }} />;
  if (orbMode === 'svg') return <ClassicDashboard />;
  // 3D mod = robot portresi tam sahne; gereksiz kutucuklar gizlenir.
  const robotMode = orbMode === '3d';

  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        background: `linear-gradient(135deg, #0a0e27 0%, #0f1434 50%, #0a0e27 100%)`,
        overflow: 'hidden',
        animation: 'dash-slide-in 380ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
      }}
    >
      <style>{`
        @keyframes dash-slide-in {
          from { transform: translateX(-100%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
      `}</style>

      {/* Ambient subtle gradient overlay for depth */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(circle at 50% 40%, rgba(0, 217, 255, 0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      {/* Mark XL top banner */}
      <div className="hud-glass-new" style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 18px',
        borderBottom: '1px solid var(--glass-border)',
        fontFamily: 'var(--font-orbitron, monospace)',
        fontSize: 11, color: '#9fb3c8',
        letterSpacing: '0.3em', zIndex: 5,
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
      }}>
        <span style={{ color: '#9fb3c8' }}>Balıkesir</span>
        <span className="hud-glow" style={{ fontSize: 18, color: '#00d9ff', letterSpacing: '0.5em' }}>
          XJARVIS
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a
            href="/news"
            style={{
              fontFamily: 'var(--font-orbitron, monospace)',
              fontSize: 11, letterSpacing: '0.3em',
              padding: '4px 10px',
              border: '1px solid rgba(0, 217, 255, 0.35)',
              color: '#00d9ff',
              textDecoration: 'none',
              borderRadius: 4,
              background: 'rgba(0, 217, 255, 0.08)',
              transition: 'all 120ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(0, 217, 255, 0.15)';
              e.currentTarget.style.boxShadow = 'inset 0 0 8px rgba(0, 217, 255, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(0, 217, 255, 0.08)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            NEWS
          </a>
          <span style={{ fontSize: 9, opacity: 0.6, color: '#9fb3c8' }}>v6.0 · MARK XL</span>
          <DashboardTopActions />
          <OrbStyleSwitcher />
          <DashboardHamburger />
        </div>
      </div>

      <CameraFeed />

      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {!robotMode && <StereoWaveform side="left" height={220} width={20} />}
          <JarvisOrb size={260} />
          {!robotMode && <StereoWaveform side="right" height={220} width={20} />}
        </div>
        <LiveTalkButton />
      </div>

      {!robotMode && (<>
      <Slot id="clock" hidden={hidden} index={0}><ClockWidget position={{ top: '3%', left: 'calc(50% - 80px)' }} /></Slot>
      <Slot id="cryptoForex" hidden={hidden} index={1}><CryptoForexWidget position={{ top: '8%', right: '4%' }} /></Slot>
      <Slot id="activityLog" hidden={hidden} index={2}><ActivityLogWidget position={{ top: 'calc(50% - 110px)', right: '2%' }} /></Slot>
      <Slot id="weather" hidden={hidden} index={3}><WeatherWidget position={{ bottom: '20%', right: '4%' }} /></Slot>
      <Slot id="markets" hidden={hidden} index={4}><MarketsWidget position={{ bottom: '3%', left: 'calc(50% - 80px)' }} /></Slot>
      <Slot id="systemHealth" hidden={hidden} index={5}><SystemHealthWidget position={{ bottom: '20%', left: '4%' }} /></Slot>
      <Slot id="systemStatus" hidden={hidden} index={6}><SystemStatusWidget position={{ top: 'calc(50% - 110px)', left: '2%' }} /></Slot>
      <Slot id="battery" hidden={hidden} index={7}><BatteryWidget position={{ top: '8%', left: '4%' }} /></Slot>
      <Slot id="voiceTimeline" hidden={hidden} index={8}><VoiceTimelineWidget position={{ bottom: '3%', left: '20%' }} /></Slot>
      <Slot id="latency" hidden={hidden} index={9}><LatencyWidget position={{ bottom: '3%', right: '20%' }} /></Slot>
      <Slot id="controlPanel" hidden={hidden} index={10}><ControlPanelWidget position={{ top: 'calc(50% + 130px)', left: 'calc(50% - 100px)' }} /></Slot>
      <Slot id="subAgents" hidden={hidden} index={11}><SubAgentsWidget position={{ top: '3%', right: 'calc(50% - 200px)' }} /></Slot>
      <Slot id="agentVoice" hidden={hidden} index={12}><AgentVoiceWidget position={{ top: '50%', right: '34%' }} /></Slot>
      <Slot id="pomodoro" hidden={hidden} index={13}><PomodoroWidget position={{ top: '3%', right: '14%' }} /></Slot>
      <Slot id="nowPlaying" hidden={hidden} index={14}><NowPlayingWidget position={{ top: '50%', right: '18%' }} /></Slot>
      <Slot id="health" hidden={hidden} index={15}><HealthWidget position={{ bottom: '3%', right: '36%' }} /></Slot>
      <Slot id="stockTicker" hidden={hidden} index={16}><StockTickerWidget position={{ top: '50%', left: '14%' }} /></Slot>
      </>)}
    </main>
  );
}
