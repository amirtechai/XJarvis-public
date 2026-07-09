// Backend taban URL'inin TEK kaynağı.
// - Tauri app / localhost dev → http://localhost:3001 (Mac lokal backend)
// - Uzak web deploy (xjarvis.your-domain.example) → same-origin: fetch'ler relative,
//   WS nginx'in /ws location'ından proxy'lenir (backend her path'te upgrade kabul eder).
const isRemoteWeb =
  typeof window !== 'undefined' &&
  /^https?:$/.test(window.location.protocol) &&
  !['localhost', '127.0.0.1'].includes(window.location.hostname);

export const BACKEND = isRemoteWeb ? '' : 'http://localhost:3001';

export const WS_URL = isRemoteWeb
  ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
  : 'ws://localhost:3001';
