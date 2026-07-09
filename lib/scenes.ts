export interface Scene {
  id: string;
  label: string;
  path: string;
  description: string;
  voiceTriggers: string[];
  themeRgb?: string;          // override; null → kullanıcı seçimi
  icon: string;               // emoji veya kısa string
}

export const SCENES: Scene[] = [
  { id: 'dashboard', label: 'Orbital HUD',     path: '/dashboard', description: 'Ana panel — orb + widget grid', voiceTriggers: ['ana ekran', 'dashboard', 'hud'], icon: '◎' },
  { id: 'news',      label: 'News Mode',       path: '/news',      description: 'Canlı TV + ticker + manşetler', voiceTriggers: ['haberler', 'news mode'], icon: '◇' },
  { id: 'world',     label: 'World Watch',     path: '/world',     description: 'Dünya çatışma haritası + canlı haber', voiceTriggers: ['dünya haritası', 'world watch', 'dünya'], icon: '◯' },
  { id: 'cyber',     label: 'Cyber Dashboard', path: '/cyber',     description: 'Birleşik gelen kutusu, eylem kuyruğu, gelir', voiceTriggers: ['cyber moda', 'iş paneli', 'cyber'], icon: '▤' },
  { id: 'creative',  label: 'Creative Lab',    path: '/creative',  description: 'AI görsel + reklam üretimi', voiceTriggers: ['kreatif lab', 'creative', 'reklam üret'], icon: '✦' },
  { id: 'dev',       label: 'Dev Mode',        path: '/dev',       description: 'PR, commit, terminal feed', voiceTriggers: ['dev moda', 'kod paneli', 'developer'], icon: '◧' },
  { id: 'trading',   label: 'Trading Floor',   path: '/trading',   description: 'Portföy + intraday + alarm', voiceTriggers: ['trading paneli', 'trading', 'borsa'], icon: '◢' },
];

export function findSceneByVoice(text: string): Scene | null {
  const norm = text.toLowerCase().replace(/[^\wçğıöşü ]/g, '').replace(/\s+/g, ' ').trim();
  for (const s of SCENES) {
    for (const t of s.voiceTriggers) if (norm.includes(t)) return s;
  }
  return null;
}
