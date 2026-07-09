import { DashboardClient } from './dashboard/DashboardClient';

export const metadata = {
  title: 'Jarvis · Orbital HUD',
};

export default function Home() {
  return <DashboardClient />;
}
