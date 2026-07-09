'use client';
import { BACKEND } from '@/lib/backend';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface Command {
  id: string;
  label: string;
  hint?: string;
  action: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const goto = (p: string) => () => { router.push(p); setOpen(false); };
  const post = (path: string, body?: unknown) => () => {
    fetch(`${BACKEND}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method: 'POST' }).catch(() => {});
    setOpen(false);
  };

  const COMMANDS: Command[] = [
    // Scenes
    { id: 'sc-dash', label: '◎  Orbital HUD',     hint: 'dashboard', action: goto('/dashboard') },
    { id: 'sc-news', label: '◇  News Mode',       hint: 'news',      action: goto('/news') },
    { id: 'sc-world',label: '◯  World Watch',     hint: 'world',     action: goto('/world') },
    { id: 'sc-cyber',label: '▤  Cyber Dashboard', hint: 'cyber',     action: goto('/cyber') },
    { id: 'sc-creat',label: '✦  Creative Lab',    hint: 'creative',  action: goto('/creative') },
    { id: 'sc-dev',  label: '◧  Dev Mode',        hint: 'dev',       action: goto('/dev') },
    { id: 'sc-trade',label: '◢  Trading Floor',   hint: 'trading',   action: goto('/trading') },
    // Settings
    { id: 'set',     label: '⚙  Ayarlar',         hint: 'preferences', action: goto('/preferences') },
    { id: 'logs',    label: '📜 Loglar',          hint: 'logs',      action: goto('/logs') },
    { id: 'health',  label: '♥  Sağlık',         hint: 'health',    action: goto('/health') },
    // Models
    { id: 'm-haiku', label: '🤖 Haiku 4.5\'e geç',  hint: 'model',  action: post('/api/agent/model', { id: 'haiku' }) },
    { id: 'm-sonnet',label: '🤖 Sonnet 4.6\'ya geç', hint: 'model', action: post('/api/agent/model', { id: 'sonnet' }) },
    { id: 'm-opus',  label: '🤖 Opus 4.7\'ye geç',   hint: 'model', action: post('/api/agent/model', { id: 'opus' }) },
    // Voice/system
    { id: 'restart-voice', label: '🎙 Voice servisini yeniden başlat', hint: 'voice', action: post('/api/services/start', { name: 'voice' }) },
    { id: 'restart-vision',label: '👁 Vision servisini yeniden başlat', hint: 'vision', action: post('/api/services/start', { name: 'vision' }) },
    { id: 'jarvis-on', label: '◉ JARVIS\'i aç',  hint: 'on', action: post('/api/control/jarvis') },
    { id: 'mic-toggle',label: '🎤 Mikrofon toggle', hint: 'mic', action: post('/api/control/mic') },
    // Page-aware actions (only relevant ones surfaced)
    ...pageActions(pathname || '', goto, post),
  ];

  const filtered = query
    ? COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : COMMANDS;

  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setOpen((v) => !v);
      setQuery('');
    }
    if (e.key === 'Escape') setOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '20vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          width: 480,
          maxWidth: '90vw',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 10 }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Enter' && filtered[selected]) {
                filtered[selected].action();
                setOpen(false);
              }
            }}
            placeholder="Komut ara…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 14,
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: 4 }}>ESC</span>
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              Sonuç bulunamadı
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                onClick={() => { cmd.action(); setOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: i === selected ? 'var(--bg-surface)' : 'transparent',
                  color: i === selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 13,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={() => setSelected(i)}
              >
                <span>{cmd.label}</span>
                {cmd.hint && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'ui-monospace, monospace', background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>
                    {cmd.hint}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

type GotoFn = (p: string) => () => void;
type PostFn = (path: string, body?: unknown) => () => void;

function pageActions(pathname: string, goto: GotoFn, post: PostFn): Command[] {
  if (pathname.startsWith('/youtube')) {
    return [
      { id: 'yt-7pane', label: '▶ Layout: 7-PANE',  hint: 'page', action: () => { localStorage.setItem('xjarvis:youtube:layout', '"hero7"'); location.reload(); } },
      { id: 'yt-2x4',   label: '▶ Layout: 4×2',     hint: 'page', action: () => { localStorage.setItem('xjarvis:youtube:layout', '"grid4x2"'); location.reload(); } },
      { id: 'yt-3x3',   label: '▶ Layout: 3×3',     hint: 'page', action: () => { localStorage.setItem('xjarvis:youtube:layout', '"grid3x3"'); location.reload(); } },
    ];
  }
  if (pathname.startsWith('/notion')) {
    return [
      { id: 'nt-new',  label: '✍ Notion: yeni sayfa', hint: 'page', action: () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true })); } },
      { id: 'nt-save', label: '💾 Notion: kaydet',     hint: 'page', action: () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true })); } },
    ];
  }
  if (pathname.startsWith('/design')) {
    return [
      { id: 'd-flux-pro',label: '✦ Design: Flux Pro\'ya geç',  hint: 'page', action: () => { localStorage.setItem('xjarvis:design:model', 'flux-pro'); location.reload(); } },
      { id: 'd-flux-s', label: '✦ Design: Flux Schnell',       hint: 'page', action: () => { localStorage.setItem('xjarvis:design:model', 'flux-schnell'); location.reload(); } },
    ];
  }
  if (pathname.startsWith('/research')) {
    return [
      { id: 'r-focus', label: '⌕ Research: prompt\'a odaklan', hint: 'page', action: () => { (document.querySelector('input[placeholder*="Sor"]') as HTMLInputElement | null)?.focus(); } },
    ];
  }
  if (pathname.startsWith('/agents')) {
    return [
      { id: 'a-spawn', label: '☷ Agents: yeni run başlat', hint: 'page', action: () => { const g = prompt('Goal?'); if (g) post('/api/agents/runs', { pipeline: 'planner-coder-reviewer-tester', prompt: g })(); } },
    ];
  }
  if (pathname.startsWith('/dashboard')) {
    return [
      { id: 'orb-q', label: '🔮 Orb: Quantum',  hint: 'page', action: () => { localStorage.setItem('xjarvis:orbStyle', 'quantum'); location.reload(); } },
      { id: 'orb-c', label: '🔮 Orb: Classic',  hint: 'page', action: () => { localStorage.setItem('xjarvis:orbStyle', 'svg'); location.reload(); } },
      { id: 'orb-3', label: '🔮 Orb: 3D',       hint: 'page', action: () => { localStorage.setItem('xjarvis:orbStyle', '3d'); localStorage.setItem('xjarvis:orb3d', '1'); location.reload(); } },
      { id: 'mon-2', label: '🖥 Ekran: 50/50',  hint: 'page', action: post('/api/monitors/arrange', { count: 2 }) },
      { id: 'mon-4', label: '🖥 Ekran: 2×2',    hint: 'page', action: post('/api/monitors/arrange', { count: 4 }) },
    ];
  }
  if (pathname.startsWith('/companion')) {
    return [
      { id: 'cmp-clear', label: '⌬ Companion: kuyruğu temizle (manuel)', hint: 'page', action: () => alert('Henüz desteklenmiyor.') },
    ];
  }
  return [];
}
