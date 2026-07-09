'use client';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';

interface WidgetShellProps {
  title?: string;
  position?: { top?: string; bottom?: string; left?: string; right?: string };
  size?: number;
  width?: number | string;
  height?: number | string;
  children: ReactNode;
}

interface SavedState { left?: number; top?: number; w?: number; h?: number; shape?: 'circle' | 'square' }

function storageKey(title?: string): string {
  return `xjarvis:widget:${(title || 'untitled').toLowerCase().replace(/\s+/g, '-')}`;
}

function loadSaved(title?: string): SavedState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(title));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSaved(title: string | undefined, s: SavedState) {
  try { localStorage.setItem(storageKey(title), JSON.stringify(s)); } catch { /* swallow */ }
}

class WidgetErrorBoundary extends Component<{ title?: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '0.5rem', fontSize: '0.65rem', color: 'var(--hud-red)' }}>
          ⚠ {this.props.title ?? 'widget'} fail
        </div>
      );
    }
    return this.props.children;
  }
}

type ResizeDir = 'r' | 'b' | 'br' | 'l' | 't' | 'tl' | 'tr' | 'bl';

export function WidgetShell({ title, position = {}, size = 160, width, height, children }: WidgetShellProps) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<SavedState | null>(() => loadSaved(title));
  // Orijinalde daire mi? width/height props'u verilmemişse evet.
  // Kullanıcı saved.shape ile override edebilir (kare↔daire toggle).
  const originalIsCircle = !width && !height;
  const isCircle = saved?.shape ? saved.shape === 'circle' : originalIsCircle;
  const dragRef = useRef<{ active: boolean; offsetX: number; offsetY: number }>({ active: false, offsetX: 0, offsetY: 0 });
  const resizeRef = useRef<{ active: boolean; dir: ResizeDir; startX: number; startY: number; startW: number; startH: number; startLeft: number; startTop: number }>({
    active: false, dir: 'br', startX: 0, startY: 0, startW: 0, startH: 0, startLeft: 0, startTop: 0,
  });
  const elRef = useRef<HTMLDivElement | null>(null);

  // pointer move/up while editing
  useEffect(() => {
    if (!editing) return;
    const onMove = (e: PointerEvent) => {
      if (resizeRef.current.active) {
        const dx = e.clientX - resizeRef.current.startX;
        const dy = e.clientY - resizeRef.current.startY;
        const r = resizeRef.current;
        let w = r.startW, h = r.startH, left = r.startLeft, top = r.startTop;
        if (r.dir.includes('r')) w = Math.max(80, r.startW + dx);
        if (r.dir.includes('b')) h = Math.max(60, r.startH + dy);
        if (r.dir.includes('l')) { w = Math.max(80, r.startW - dx); left = r.startLeft + dx; }
        if (r.dir.includes('t')) { h = Math.max(60, r.startH - dy); top  = r.startTop + dy; }
        // Daire widget'larında aspect lock — w=h ve left/top simetrik düzelt
        if (isCircle) {
          const newSize = Math.max(w, h);
          if (r.dir.includes('l')) left = r.startLeft + (r.startW - newSize);
          if (r.dir.includes('t')) top  = r.startTop  + (r.startH - newSize);
          w = h = newSize;
        }
        setSaved((prev) => ({ ...(prev || {}), w, h, left, top }));
        return;
      }
      if (dragRef.current.active) {
        const x = e.clientX - dragRef.current.offsetX;
        const y = e.clientY - dragRef.current.offsetY;
        setSaved((prev) => ({ ...(prev || {}), left: Math.max(0, x), top: Math.max(0, y) }));
      }
    };
    const onUp = () => {
      if (dragRef.current.active || resizeRef.current.active) {
        dragRef.current.active = false;
        resizeRef.current.active = false;
        setSaved((s) => { if (s) saveSaved(title, s); return s; });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [editing, title]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editing) setEditing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  // Edit modunda — widget DIŞINA tıklanınca commit ve çıkış.
  // (Çift tıklayıp aynı yerde devam etmek konumu zıplatıyordu.)
  useEffect(() => {
    if (!editing) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const el = elRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      // Aktif drag/resize varsa pointerup'i bekle, sonra çık
      if (dragRef.current.active || resizeRef.current.active) return;
      setEditing(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [editing]);

  const onDoubleClick = () => setEditing((v) => !v);

  // Üçlü tık — daire widget'larında resize modunu zorla. Aynı widget üzerinde
  // ardışık 3 click 600ms içinde olmalı; aksi halde tek/çift tık olarak akar.
  const clickCountRef = useRef<{ n: number; t: number }>({ n: 0, t: 0 });
  const onClickHandler = (_e: React.MouseEvent) => {
    const now = Date.now();
    if (now - clickCountRef.current.t > 600) clickCountRef.current.n = 0;
    clickCountRef.current.t = now;
    clickCountRef.current.n += 1;
    if (clickCountRef.current.n >= 3) {
      clickCountRef.current.n = 0;
      setEditing(true);
    }
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!editing) return;
    e.preventDefault();
    const r = elRef.current?.getBoundingClientRect();
    if (!r) return;
    dragRef.current = { active: true, offsetX: e.clientX - r.left, offsetY: e.clientY - r.top };
    // ensure size baseline saved
    setSaved((prev) => ({ ...(prev || {}), left: r.left, top: r.top, w: prev?.w ?? r.width, h: prev?.h ?? r.height }));
  };
  const startResize = (dir: ResizeDir) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const r = elRef.current?.getBoundingClientRect();
    if (!r) return;
    resizeRef.current = {
      active: true, dir,
      startX: e.clientX, startY: e.clientY,
      startW: r.width, startH: r.height,
      startLeft: r.left, startTop: r.top,
    };
    setSaved((prev) => ({ ...(prev || {}), left: r.left, top: r.top, w: r.width, h: r.height }));
  };

  const reset = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setSaved(null);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(storageKey(title));
  };

  const styleBase: React.CSSProperties = {
    position: 'absolute',
    width: saved?.w ?? width ?? size,
    height: saved?.h ?? height ?? size,
    borderRadius: isCircle ? '50%' : 6,
    padding: '0.6rem 0.75rem',
    display: 'flex', flexDirection: 'column', gap: '0.25rem',
    // Edit modunda resize handle'ları daire dışına taşar; overflow:hidden
    // bunları kırpıyor — bu yüzden editing iken visible'a çeviriyoruz.
    overflow: editing ? 'visible' : 'hidden',
    transition: editing ? 'border-color 180ms ease' : 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
    color: 'var(--hud-cyan, #00d4ff)',
    fontSize: '0.7rem',
    background: 'linear-gradient(180deg, rgba(2,18,32,0.86) 0%, rgba(0,8,20,0.92) 100%)',
    border: `1px solid ${editing ? '#facc15' : 'rgba(var(--hud-rgb),0.45)'}`,
    boxShadow: editing
      ? '0 0 0 2px rgba(250,204,21,0.35), 0 0 22px rgba(250,204,21,0.4)'
      : '0 0 0 1px rgba(var(--hud-rgb),0.08), 0 0 18px rgba(var(--hud-rgb),0.18), inset 0 0 24px rgba(0,90,140,0.18)',
    cursor: editing ? 'grab' : 'default',
    userSelect: editing ? 'none' : 'auto',
    touchAction: editing ? 'none' : 'auto',
  };

  const positionStyle: React.CSSProperties = (saved?.left != null && saved?.top != null)
    ? { left: saved.left, top: saved.top, right: 'auto', bottom: 'auto' }
    : position;

  // Resize handles (only visible while editing)
  const handle: React.CSSProperties = {
    position: 'absolute', background: 'rgba(250,204,21,0.55)', border: '1px solid #facc15',
    boxShadow: '0 0 6px rgba(250,204,21,0.6)',
    pointerEvents: 'auto',
  };

  return (
    <div
      ref={elRef}
      className="hud-font"
      onClick={onClickHandler}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      style={{ ...styleBase, ...positionStyle }}
      onMouseEnter={(e) => {
        if (editing) return;
        e.currentTarget.style.transform = 'scale(1.04)';
        e.currentTarget.style.borderColor = 'rgba(var(--hud-rgb),0.85)';
      }}
      onMouseLeave={(e) => {
        if (editing) return;
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.borderColor = 'rgba(var(--hud-rgb),0.45)';
      }}
    >
      <CornerBrackets editing={editing} />
      {title && (
        <div style={{
          fontSize: '0.55rem', letterSpacing: '0.22em',
          color: editing ? '#fde68a' : 'rgba(var(--hud-rgb),0.85)',
          textAlign: 'left', paddingBottom: 4,
          borderBottom: `1px solid ${editing ? 'rgba(250,204,21,0.35)' : 'rgba(var(--hud-rgb),0.18)'}`,
          textShadow: editing ? '0 0 8px rgba(250,204,21,0.5)' : '0 0 8px rgba(var(--hud-rgb),0.35)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4,
        }}>
          <span>{`// ${title.toUpperCase()}`}</span>
          {editing && (
            <div style={{ display: 'flex', gap: 4 }} onPointerDown={(e) => e.stopPropagation()}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSaved((prev) => {
                    const next: SavedState = { ...(prev || {}), shape: isCircle ? 'square' : 'circle' };
                    saveSaved(title, next);
                    return next;
                  });
                }}
                title={isCircle ? 'Kareye çevir' : 'Daireye çevir'}
                style={{ background: 'transparent', border: '1px solid rgba(250,204,21,0.5)', color: '#fde68a', fontSize: 9, padding: '1px 5px', borderRadius: 3, cursor: 'pointer' }}
              >{isCircle ? '⬛' : '⬤'}</button>
              {saved && (
                <button onClick={reset}
                  style={{ background: 'transparent', border: '1px solid rgba(250,204,21,0.5)', color: '#fde68a', fontSize: 8, padding: '1px 4px', borderRadius: 3, cursor: 'pointer' }}
                >reset</button>
              )}
            </div>
          )}
        </div>
      )}
      <WidgetErrorBoundary title={title}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', textAlign: 'left', minHeight: 0 }}>
          {children}
        </div>
      </WidgetErrorBoundary>

      {editing && !isCircle && (
        <>
          {/* dikdörtgen — 4 köşe + 4 kenar */}
          <div onPointerDown={startResize('br')} style={{ ...handle, right: -4, bottom: -4, width: 12, height: 12, cursor: 'nwse-resize' }} />
          <div onPointerDown={startResize('bl')} style={{ ...handle, left: -4, bottom: -4, width: 12, height: 12, cursor: 'nesw-resize' }} />
          <div onPointerDown={startResize('tr')} style={{ ...handle, right: -4, top: -4, width: 12, height: 12, cursor: 'nesw-resize' }} />
          <div onPointerDown={startResize('tl')} style={{ ...handle, left: -4, top: -4, width: 12, height: 12, cursor: 'nwse-resize' }} />
          <div onPointerDown={startResize('r')} style={{ ...handle, right: -3, top: '40%', width: 6, height: '20%', cursor: 'ew-resize' }} />
          <div onPointerDown={startResize('l')} style={{ ...handle, left: -3, top: '40%', width: 6, height: '20%', cursor: 'ew-resize' }} />
          <div onPointerDown={startResize('b')} style={{ ...handle, bottom: -3, left: '40%', width: '20%', height: 6, cursor: 'ns-resize' }} />
          <div onPointerDown={startResize('t')} style={{ ...handle, top: -3, left: '40%', width: '20%', height: 6, cursor: 'ns-resize' }} />
        </>
      )}
      {editing && isCircle && (
        <>
          {/* daire — 4 cardinal handle dairenin dış kenarında (görünür ve tıklanabilir) */}
          <div onPointerDown={startResize('br')} style={{ ...handle, right: -8, bottom: -8, width: 16, height: 16, borderRadius: '50%', cursor: 'nwse-resize' }} />
          <div onPointerDown={startResize('bl')} style={{ ...handle, left: -8, bottom: -8, width: 16, height: 16, borderRadius: '50%', cursor: 'nesw-resize' }} />
          <div onPointerDown={startResize('tr')} style={{ ...handle, right: -8, top: -8, width: 16, height: 16, borderRadius: '50%', cursor: 'nesw-resize' }} />
          <div onPointerDown={startResize('tl')} style={{ ...handle, left: -8, top: -8, width: 16, height: 16, borderRadius: '50%', cursor: 'nwse-resize' }} />
          {/* Aspect-lock cardinal handle'ları — dairenin kenarında, daha kolay yakalanır */}
          <div onPointerDown={startResize('r')} style={{ ...handle, right: -8, top: 'calc(50% - 8px)', width: 16, height: 16, borderRadius: '50%', cursor: 'ew-resize' }} />
          <div onPointerDown={startResize('l')} style={{ ...handle, left: -8, top: 'calc(50% - 8px)', width: 16, height: 16, borderRadius: '50%', cursor: 'ew-resize' }} />
          <div onPointerDown={startResize('b')} style={{ ...handle, bottom: -8, left: 'calc(50% - 8px)', width: 16, height: 16, borderRadius: '50%', cursor: 'ns-resize' }} />
          <div onPointerDown={startResize('t')} style={{ ...handle, top: -8, left: 'calc(50% - 8px)', width: 16, height: 16, borderRadius: '50%', cursor: 'ns-resize' }} />
        </>
      )}
      {editing && (
        <div style={{ position: 'absolute', bottom: 4, right: 6, fontSize: 7, color: 'rgba(250,204,21,0.7)', letterSpacing: '0.15em', pointerEvents: 'none' }}>
          EDIT · ESC
        </div>
      )}
    </div>
  );
}

function CornerBrackets({ editing }: { editing?: boolean }) {
  const c = editing ? 'rgba(250,204,21,0.85)' : 'rgba(var(--hud-rgb),0.6)';
  const len = 8;
  const off = 3;
  const w = 1.4;
  const common: React.CSSProperties = {
    position: 'absolute', width: len, height: len, pointerEvents: 'none',
  };
  return (
    <>
      <div aria-hidden style={{ ...common, top: off, left: off, borderTop: `${w}px solid ${c}`, borderLeft: `${w}px solid ${c}` }} />
      <div aria-hidden style={{ ...common, top: off, right: off, borderTop: `${w}px solid ${c}`, borderRight: `${w}px solid ${c}` }} />
      <div aria-hidden style={{ ...common, bottom: off, left: off, borderBottom: `${w}px solid ${c}`, borderLeft: `${w}px solid ${c}` }} />
      <div aria-hidden style={{ ...common, bottom: off, right: off, borderBottom: `${w}px solid ${c}`, borderRight: `${w}px solid ${c}` }} />
    </>
  );
}
