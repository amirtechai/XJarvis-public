import { redirect } from 'next/navigation';

// /settings is consolidated into /preferences (RoutingSection has the
// regex model rules + SSH servers UI that used to live here).
export default function SettingsPage() {
  redirect('/preferences');
}
