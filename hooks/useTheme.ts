'use client';
import { useEffect, useState } from 'react';

export interface ThemePalette { id: string; label: string; rgb: string; }
export interface FontOption { id: string; label: string; stack: string; }
export interface ThemePreset {
  id: string;
  label: string;
  description: string;
  palette: string;
  font: string;
  bgBase: string;       // base background color
  bgElev: string;       // elevated surface
  bgGradient?: string;  // optional radial gradient
  accent?: string;      // override accent (overrides --hud-rgb if set)
  textPrimary: string;
  textSecondary: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'ironman',
    label: 'Iron Man',
    description: 'Stark Industries — koyu mavi-cyan + altın aksanlı, default.',
    palette: 'cyan', font: 'orbitron',
    bgBase: '#000610', bgElev: 'rgba(0, 12, 28, 0.85)',
    bgGradient: 'radial-gradient(ellipse at top, rgba(0,80,140,0.12) 0%, #000610 60%)',
    textPrimary: '#e0f4ff', textSecondary: '#7a9ab0',
  },
  {
    id: 'jarvis',
    label: 'JARVIS Minimal',
    description: 'Saf cyan, az renk, parlama yok — uşak modu.',
    palette: 'cyan', font: 'system',
    bgBase: '#020a14', bgElev: 'rgba(0, 16, 28, 0.6)',
    textPrimary: '#d8e8f0', textSecondary: '#7a9ab0',
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    description: 'Mor + sıcak pink, neon scanline — Night City vibes.',
    palette: 'pink', font: 'mono',
    bgBase: '#0a0014', bgElev: 'rgba(40, 8, 60, 0.7)',
    bgGradient: 'radial-gradient(ellipse at center, rgba(120,40,180,0.18) 0%, #0a0014 70%)',
    accent: '255, 80, 200',
    textPrimary: '#fce7f8', textSecondary: '#a08cc0',
  },
  {
    id: 'solarized',
    label: 'Solarized',
    description: 'Sıcak base16 — gözleri yormaz, uzun çalışma için.',
    palette: 'amber', font: 'rounded',
    bgBase: '#002b36', bgElev: 'rgba(7, 54, 66, 0.85)',
    accent: '181, 137, 0',
    textPrimary: '#eee8d5', textSecondary: '#93a1a1',
  },
  {
    id: 'oled',
    label: 'OLED Dark',
    description: 'Saf siyah arka plan — OLED batarya tasarrufu.',
    palette: 'cyan', font: 'orbitron',
    bgBase: '#000000', bgElev: '#080808',
    textPrimary: '#ffffff', textSecondary: '#888888',
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    description: 'Erişilebilirlik — yüksek kontrast, kalın font.',
    palette: 'white', font: 'system',
    bgBase: '#000000', bgElev: '#1a1a1a',
    accent: '255, 255, 255',
    textPrimary: '#ffffff', textSecondary: '#cccccc',
  },
  {
    id: 'matrix',
    label: 'Matrix',
    description: 'Yeşil terminal — dijital yağmur estetiği.',
    palette: 'green', font: 'mono',
    bgBase: '#000800', bgElev: 'rgba(0, 32, 0, 0.85)',
    bgGradient: 'radial-gradient(ellipse at center, rgba(0,180,80,0.08) 0%, #000800 70%)',
    accent: '0, 255, 65',
    textPrimary: '#a0ffb0', textSecondary: '#5a9a60',
  },
  {
    id: 'arc-reactor',
    label: 'Arc Reactor',
    description: 'Saf beyaz-cyan corona — Mark VII arc reactor parlaması.',
    palette: 'white', font: 'orbitron',
    bgBase: '#040818', bgElev: 'rgba(20, 30, 60, 0.7)',
    bgGradient: 'radial-gradient(ellipse at center, rgba(180,220,255,0.12) 0%, #040818 70%)',
    accent: '180, 220, 255',
    textPrimary: '#f0f8ff', textSecondary: '#90b0c8',
  },
];

export const PALETTES: ThemePalette[] = [
  { id: 'cyan',    label: 'Cyan',    rgb: '0, 229, 255'   },
  { id: 'blue',    label: 'Blue',    rgb: '64, 156, 255'  },
  { id: 'green',   label: 'Green',   rgb: '0, 255, 136'   },
  { id: 'amber',   label: 'Amber',   rgb: '255, 179, 71'  },
  { id: 'red',     label: 'Red',     rgb: '255, 77, 109'  },
  { id: 'purple',  label: 'Purple',  rgb: '178, 102, 255' },
  { id: 'pink',    label: 'Pink',    rgb: '255, 105, 180' },
  { id: 'white',   label: 'White',   rgb: '230, 230, 240' },
];

export const FONTS: FontOption[] = [
  { id: 'orbitron', label: 'Orbitron (default)', stack: 'var(--font-orbitron), Orbitron, monospace' },
  { id: 'mono',     label: 'SF Mono',            stack: '"SF Mono", ui-monospace, monospace' },
  { id: 'system',   label: 'San Francisco',      stack: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' },
  { id: 'serif',    label: 'Serif',              stack: 'Georgia, "Times New Roman", serif' },
  { id: 'rounded',  label: 'SF Rounded',         stack: '"SF Pro Rounded", -apple-system, sans-serif' },
];

const KEY_PALETTE = 'xjarvis:theme:palette';
const KEY_FONT    = 'xjarvis:theme:font';
const KEY_PRESET  = 'xjarvis:theme:preset';

function applyTheme(paletteId: string, fontId: string) {
  if (typeof document === 'undefined') return;
  const p = PALETTES.find((x) => x.id === paletteId) ?? PALETTES[0];
  const f = FONTS.find((x) => x.id === fontId) ?? FONTS[0];
  document.documentElement.style.setProperty('--hud-rgb', p.rgb);
  document.documentElement.style.setProperty('--font-stack', f.stack);
}

export function applyPreset(presetId: string) {
  if (typeof document === 'undefined') return;
  const t = THEME_PRESETS.find((x) => x.id === presetId);
  if (!t) return;
  applyTheme(t.palette, t.font);
  if (t.accent) document.documentElement.style.setProperty('--hud-rgb', t.accent);
  document.documentElement.style.setProperty('--bg-base', t.bgBase);
  document.documentElement.style.setProperty('--bg-elevated', t.bgElev);
  document.documentElement.style.setProperty('--text-primary', t.textPrimary);
  document.documentElement.style.setProperty('--text-secondary', t.textSecondary);
  document.body.style.background = t.bgGradient ? `${t.bgGradient}, ${t.bgBase}` : t.bgBase;
  try { localStorage.setItem(KEY_PRESET, presetId); } catch { /* noop */ }
  try { localStorage.setItem(KEY_PALETTE, t.palette); localStorage.setItem(KEY_FONT, t.font); } catch { /* noop */ }
}

export function useTheme() {
  const [palette, setPalette] = useState<string>('cyan');
  const [font, setFont] = useState<string>('orbitron');

  useEffect(() => {
    const p = localStorage.getItem(KEY_PALETTE) || 'cyan';
    const f = localStorage.getItem(KEY_FONT)    || 'orbitron';
    setPalette(p); setFont(f);
    applyTheme(p, f);
  }, []);

  const setAndApplyPalette = (id: string) => {
    setPalette(id); localStorage.setItem(KEY_PALETTE, id); applyTheme(id, font);
  };
  const setAndApplyFont = (id: string) => {
    setFont(id); localStorage.setItem(KEY_FONT, id); applyTheme(palette, id);
  };
  return { palette, font, setPalette: setAndApplyPalette, setFont: setAndApplyFont };
}

// Sayfa yüklenince hemen apply (FOUC engelleme için layout-mounted component'ten çağrılır)
export function ThemeBootstrap() {
  useEffect(() => {
    const preset = localStorage.getItem(KEY_PRESET);
    if (preset) {
      applyPreset(preset);
      return;
    }
    const p = localStorage.getItem(KEY_PALETTE) || 'cyan';
    const f = localStorage.getItem(KEY_FONT)    || 'orbitron';
    applyTheme(p, f);
  }, []);
  return null;
}
