'use client';

import { useEffect, useRef, useState } from 'react';
import { useJarvis } from '@/providers/JarvisProvider';
import { BACKEND } from '@/lib/backend';

interface RemoteCommand {
  id: string;
  text: string;
  source: string;
  ts: number;
  status: 'pending' | 'claimed' | 'done';
  result: string | null;
}

interface LocalQueueItem {
  id: string;
  goal: string;
  source: string;
  status: 'pending' | 'approved' | 'rejected' | 'done' | 'failed';
  created_at: number;
  updated_at: number;
  result?: string;
}

function detectMode(): 'remote' | 'local' {
  if (typeof window === 'undefined') return 'remote';
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === 'tauri.localhost') return 'local';
  return 'remote';
}

export function CompanionClient() {
  const [mode] = useState<'remote' | 'local'>(() => detectMode());
  if (mode === 'remote') return <RemoteCompanion />;
  return <LocalCompanion />;
}

// ───────────────────────────────────────────────────────────────────
// REMOTE — used on xjarvis.your-domain.example. Mobile-first; talks to server.
// ───────────────────────────────────────────────────────────────────
function RemoteCompanion() {
  const [token, setToken] = useState<string>('');
  const [items, setItems] = useState<RemoteCommand[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>('');
  const [ttsOn, setTtsOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('xjarvis-tts') !== '0';
  });
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const spokenRef = useRef<Set<string>>(new Set());

  // Token from URL ?token= once, then persisted in localStorage.
  useEffect(() => {
    const urlToken = new URL(window.location.href).searchParams.get('token');
    if (urlToken) {
      localStorage.setItem('xjarvis-token', urlToken);
      window.history.replaceState({}, '', window.location.pathname);
      setToken(urlToken);
    } else {
      setToken(localStorage.getItem('xjarvis-token') || '');
    }
  }, []);

  const headers = (): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(token ? { 'X-XJarvis-Token': token } : {}),
  });

  const load = async () => {
    if (!token) return;
    try {
      const r = await fetch('/api/command-queue/list', { headers: headers() });
      if (r.status === 401) {
        // Token is wrong/stale → clear it so the user sees the unlock screen
        // instead of an error overlay that never goes away.
        localStorage.removeItem('xjarvis-token');
        setToken('');
        setError('Token rejected — please re-enter.');
        return;
      }
      const j = await r.json();
      setItems(j.items || []);
      setError('');
    } catch (e) { setError(String(e)); }
  };

  useEffect(() => {
    if (!token) return;
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [token]);

  // Play newly-completed replies via server-side ElevenLabs (same Lily
  // voice the Mac uses). The audio is cached server-side so repeat
  // playbacks are instant.
  const seededRef = useRef(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playQueueRef = useRef<string[]>([]);
  const playingRef = useRef(false);

  const playNext = () => {
    if (playingRef.current) return;
    const nextId = playQueueRef.current.shift();
    if (!nextId) return;
    playingRef.current = true;
    const url = `/api/voice/tts/${nextId}?token=${encodeURIComponent(token)}`;
    let a = audioElRef.current;
    if (!a) {
      a = new Audio();
      a.preload = 'auto';
      audioElRef.current = a;
    }
    a.src = url;
    a.onended = () => { playingRef.current = false; playNext(); };
    a.onerror = () => {
      // iOS will fail with NotAllowedError if the element wasn't primed
      // by a gesture. Show a hint so the user knows to tap once.
      setError('Audio blocked — tap the mic once to unlock playback.');
      playingRef.current = false; playNext();
    };
    a.play().catch((e) => {
      if (e instanceof DOMException && e.name === 'NotAllowedError') setError('Audio blocked — tap the mic once to unlock playback.');
      playingRef.current = false; playNext();
    });
  };

  useEffect(() => {
    if (!items.length) return;
    if (!seededRef.current) {
      for (const it of items) if (it.status === 'done') spokenRef.current.add(it.id);
      seededRef.current = true;
      return;
    }
    if (!ttsOn) return;
    for (const it of items) {
      if (it.status !== 'done' || !it.result) continue;
      if (spokenRef.current.has(it.id)) continue;
      spokenRef.current.add(it.id);
      playQueueRef.current.push(it.id);
    }
    playNext();
  }, [items, ttsOn]);

  // Stop audio when TTS is muted.
  useEffect(() => {
    if (!ttsOn && audioElRef.current) {
      try { audioElRef.current.pause(); } catch {}
      audioElRef.current.currentTime = 0;
      playQueueRef.current = [];
      playingRef.current = false;
    }
  }, [ttsOn]);

  const push = async (text: string, source = 'web') => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const r = await fetch('/api/command-queue/push', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ text: text.trim(), source }),
      });
      if (r.status === 401) setError('Unauthorized — bad token.');
      else { setInput(''); load(); }
    } catch (e) { setError(String(e)); }
    finally { setSending(false); }
  };

  // MediaRecorder → server STT. Far more reliable than SpeechRecognition on iOS.
  const pickMime = (): string => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'];
    if (typeof MediaRecorder === 'undefined') return '';
    for (const m of candidates) if (MediaRecorder.isTypeSupported?.(m)) return m;
    return '';
  };

  // iOS Safari blocks audio.play() unless triggered by a user gesture.
  // Prime the audio element on the first mic tap so later TTS replies
  // (which arrive async) can play without an autoplay block.
  const primeAudio = () => {
    if (audioElRef.current) return;
    try {
      const a = new Audio();
      a.preload = 'auto';
      // Tiny silent MP3 (1 frame). Lets the element gain user-gesture rights.
      a.src = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAAcAAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA////////////////////////////////////////////8AAAAAAAAAAAAAAAAAAAAAAAAAA';
      a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
      audioElRef.current = a;
    } catch { /* ignore */ }
  };

  const startRecord = async () => {
    setError('');
    primeAudio();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not available in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        setRecording(false);
        // Always release the mic so iOS shows the orange dot turning off.
        try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || 'audio/webm' });
        chunksRef.current = [];
        if (!blob.size) { setError('No audio captured.'); return; }
        setUploading(true);
        try {
          const r = await fetch('/api/voice/transcribe-and-push', {
            method: 'POST',
            headers: {
              'Content-Type': blob.type,
              'X-Source': 'voice-mobile',
              ...(token ? { 'X-XJarvis-Token': token } : {}),
            },
            body: blob,
          });
          if (r.status === 401) setError('Unauthorized.');
          else if (!r.ok) setError(`STT failed: ${r.status}`);
          else {
            await r.json();
            load();
          }
        } catch (e) { setError('Upload: ' + String(e)); }
        finally { setUploading(false); }
      };
      rec.onerror = (e) => {
        const err = e as ErrorEvent & { error?: Error };
        setError('Recorder: ' + (err.error?.message || err.message || 'unknown'));
        setRecording(false);
      };
      rec.start();
      setRecording(true);
    } catch (e) {
      const err = e as Error;
      setError('Mic permission: ' + (err.message || String(e)));
      setRecording(false);
    }
  };

  const stopRecord = () => {
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch (e) { setError('Stop error: ' + String(e)); }
    }
    // Defensive: ensure UI flips out of recording even if onstop is delayed.
    setRecording(false);
  };

  if (!token) {
    return (
      <TokenSetup onSet={(t) => {
        localStorage.setItem('xjarvis-token', t);
        setToken(t);
      }} />
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 50% 20%, #0a1424 0%, #02060d 80%)',
      color: '#cfe9ff',
      padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <header style={{
        padding: '16px 18px 10px',
        borderBottom: '1px solid rgba(0,212,255,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-orbitron, monospace)', fontSize: 18, letterSpacing: '0.4em', color: '#9ed8ff', textShadow: '0 0 12px rgba(0,212,255,0.55)' }}>
            XJARVIS
          </div>
          <div style={{ fontSize: 10, opacity: 0.5, letterSpacing: '0.2em', marginTop: 2 }}>REMOTE COMPANION</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              const v = !ttsOn;
              setTtsOn(v);
              localStorage.setItem('xjarvis-tts', v ? '1' : '0');
            }}
            style={pillBtn(ttsOn ? '#34d399' : '#5a6378')}
            title="Toggle voice replies"
          >{ttsOn ? '🔊 TTS' : '🔇 TTS'}</button>
          <button
            onClick={() => { localStorage.removeItem('xjarvis-token'); setToken(''); }}
            style={pillBtn('#ff8888')}
          >LOGOUT</button>
        </div>
      </header>

      {error && (
        <div style={{ padding: '8px 14px', background: 'rgba(255,77,109,0.12)', color: '#ff8888', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* PUSH-TO-TALK ORB */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0 12px' }}>
        <button
          onClick={recording ? stopRecord : startRecord}
          aria-label="Push to talk"
          style={{
            width: 140, height: 140, borderRadius: '50%',
            border: `2px solid ${recording ? '#ff5577' : '#00d4ff'}`,
            background: recording
              ? 'radial-gradient(circle, rgba(255,85,119,0.4), rgba(255,85,119,0.05))'
              : 'radial-gradient(circle, rgba(0,212,255,0.35), rgba(0,212,255,0.05))',
            color: recording ? '#ff5577' : '#00d4ff',
            fontSize: 48,
            cursor: 'pointer',
            boxShadow: recording
              ? '0 0 32px rgba(255,85,119,0.6), inset 0 0 24px rgba(255,85,119,0.3)'
              : '0 0 32px rgba(0,212,255,0.45), inset 0 0 24px rgba(0,212,255,0.2)',
            transition: 'all 200ms ease',
            animation: recording ? 'orb-pulse 1.2s ease-in-out infinite' : 'none',
          }}
        >
          {recording ? '■' : '🎙'}
        </button>
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, letterSpacing: '0.2em', color: '#9ed8ff', opacity: 0.7, marginBottom: 16 }}>
        {uploading ? 'TRANSCRIBING…' : recording ? 'LISTENING — TAP TO STOP' : 'TAP TO SPEAK'}
      </div>

      {/* Text push form */}
      <div style={{ padding: '0 14px 14px' }}>
        <form onSubmit={(e) => { e.preventDefault(); push(input); }}
              style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a command…"
            inputMode="text"
            autoComplete="off"
            style={{
              flex: 1, padding: '14px 16px',
              background: 'rgba(0,12,24,0.7)',
              border: '1px solid rgba(0,212,255,0.35)',
              borderRadius: 10,
              color: '#cfe9ff', fontSize: 16,
              outline: 'none',
            }}
          />
          <button type="submit" disabled={sending || !input.trim()} style={{
            padding: '0 18px',
            background: 'linear-gradient(180deg, #00d4ff22, #00d4ff08)',
            border: '1px solid #00d4ff',
            color: '#00d4ff',
            borderRadius: 10,
            fontSize: 16, fontWeight: 700,
            cursor: 'pointer',
            opacity: sending || !input.trim() ? 0.4 : 1,
          }}>→</button>
        </form>
      </div>

      {/* Queue */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '0 14px 24px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 4px', fontSize: 11, letterSpacing: '0.18em', color: '#9ed8ff', opacity: 0.7,
        }}>
          <span>◢ QUEUE</span>
          <span>{items.length} total</span>
        </div>
        {items.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', opacity: 0.4, fontSize: 13 }}>
            No commands yet. Tap the mic or type one above.
          </div>
        )}
        {items.map((it) => {
          const color = it.status === 'done' ? '#34d399'
                       : it.status === 'claimed' ? '#3b82f6'
                       : '#fbbf24';
          return (
            <div key={it.id} style={{
              padding: 12, marginBottom: 8, borderRadius: 8,
              background: 'rgba(0,12,24,0.55)',
              border: `1px solid ${color}44`,
              borderLeft: `3px solid ${color}`,
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{
                  fontSize: 9, padding: '2px 8px', borderRadius: 10,
                  background: `${color}22`, border: `1px solid ${color}`, color,
                  letterSpacing: '0.14em', fontWeight: 700,
                }}>{it.status.toUpperCase()}</span>
                <span style={{ fontSize: 10, opacity: 0.55 }}>
                  {new Date(it.ts).toLocaleString()} · {it.source}
                </span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.45, marginBottom: it.result ? 6 : 0 }}>
                {it.text}
              </div>
              {it.result && <ReplyBody text={it.result} token={token} />}
            </div>
          );
        })}
      </main>

      <style jsx>{`
        @keyframes orb-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 32px rgba(255,85,119,0.6), inset 0 0 24px rgba(255,85,119,0.3); }
          50%      { transform: scale(1.06); box-shadow: 0 0 48px rgba(255,85,119,0.9), inset 0 0 30px rgba(255,85,119,0.45); }
        }
      `}</style>
    </div>
  );
}

function TokenSetup({ onSet }: { onSet: (token: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: '#02060d', color: '#cfe9ff', gap: 20,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ fontFamily: 'var(--font-orbitron, monospace)', fontSize: 22, letterSpacing: '0.4em', color: '#9ed8ff' }}>
        XJARVIS
      </div>
      <p style={{ fontSize: 13, opacity: 0.7, textAlign: 'center', maxWidth: 320 }}>
        Enter your shared token to access the companion. Get it from <code style={{ fontSize: 11 }}>backend/.env</code>
        &nbsp;or open <br/> <code style={{ fontSize: 11 }}>?token=XXX</code> in the URL.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); const v = val.trim(); if (v) onSet(v); }}
            style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 360 }}>
        <input
          type="password" autoComplete="off"
          value={val} onChange={(e) => setVal(e.target.value)}
          placeholder="XJARVIS_SHARED_TOKEN"
          style={{
            padding: '14px 16px', background: 'rgba(0,12,24,0.7)',
            border: '1px solid rgba(0,212,255,0.35)', borderRadius: 10,
            color: '#cfe9ff', fontSize: 14, outline: 'none',
          }}
        />
        <button type="submit" style={{
          padding: '14px 16px',
          background: 'linear-gradient(180deg, #00d4ff22, #00d4ff08)',
          border: '1px solid #00d4ff', color: '#00d4ff',
          borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>UNLOCK</button>
      </form>
    </div>
  );
}

// Renders an agent reply, replacing [SCREENSHOT <url>] markers with an
// actual <img>. Also strips remaining markers and tool-call noise.
function ReplyBody({ text, token }: { text: string; token: string }) {
  const re = /\[SCREENSHOT\s+(\S+?)\]/g;
  const parts: Array<{ kind: 'text' | 'image'; value: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', value: text.slice(last, m.index) });
    parts.push({ kind: 'image', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });

  return (
    <div style={{ fontSize: 12, color: '#9ed8ff', opacity: 0.85, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) => {
        if (p.kind === 'image') {
          const sep = p.value.includes('?') ? '&' : '?';
          const src = p.value + sep + 'token=' + encodeURIComponent(token);
          return (
            <a key={i} href={src} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 8 }}>
              <img
                src={src} alt="screenshot"
                style={{
                  maxWidth: '100%', borderRadius: 8,
                  border: '1px solid rgba(0,212,255,0.35)',
                  boxShadow: '0 0 16px rgba(0,212,255,0.25)',
                }}
              />
            </a>
          );
        }
        const cleaned = p.value.replace(/\[shell_exec\][^\n]*\n?/g, '').replace(/^→\s*/, '');
        return cleaned.trim() ? <div key={i}>→ {cleaned}</div> : null;
      })}
    </div>
  );
}

function pillBtn(color: string): React.CSSProperties {
  return {
    padding: '6px 12px', fontSize: 10, letterSpacing: '0.14em',
    background: `${color}18`, border: `1px solid ${color}`, color,
    borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
  };
}

// ───────────────────────────────────────────────────────────────────
// LOCAL — used on the Mac's HUD. Unchanged behavior: shows local queue.
// ───────────────────────────────────────────────────────────────────
function LocalCompanion() {
  const [items, setItems] = useState<LocalQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const jarvis = useJarvis();

  const load = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/queue/recent?limit=30`);
      const j = await r.json();
      setItems(j.items || []);
    } catch { /* offline */ } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const ack = async (id: string, status: LocalQueueItem['status'], result = '') => {
    await fetch(`${BACKEND}/api/queue/ack/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, result }),
    });
    load();
  };

  const approveAndRun = async (it: LocalQueueItem) => {
    await ack(it.id, 'approved');
    if (jarvis.connected) jarvis.send(it.goal, 'voice_input');
    setTimeout(() => ack(it.id, 'done', '(dispatched to agent)'), 500);
  };

  const pending = items.filter((i) => i.status === 'pending');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 12, background: 'var(--bg-base)' }}>
      <div className="hud-font" style={{
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(0,8,20,0.55)',
        border: '1px solid rgba(var(--hud-rgb),0.25)',
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--hud-cyan)', fontWeight: 700 }}>◢ COMPANION QUEUE</span>
        <span style={{ fontSize: 11, color: '#fbbf24' }}>{pending.length} pending</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>· {items.length} total</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-secondary)', opacity: 0.7 }}>
          xjarvis.your-domain.example → buraya yansır
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>Yükleniyor…</div>}
        {!loading && items.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', opacity: 0.5, fontSize: 12 }}>
            Henüz uzaktan komut gelmedi. xjarvis.your-domain.example veya phone PWA&apos;dan komut yolla.
          </div>
        )}
        {items.map((it) => {
          const c = STATUS_COLOR[it.status];
          return (
            <div key={it.id} style={{
              padding: 14, borderRadius: 6,
              background: 'rgba(0,8,20,0.4)',
              border: `1px solid ${c}55`,
              borderLeft: `4px solid ${c}`,
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                <span style={{
                  fontSize: 9, padding: '2px 8px', borderRadius: 10,
                  background: `${c}25`, border: `1px solid ${c}`, color: c,
                  letterSpacing: '0.14em', fontWeight: 700,
                }}>{it.status.toUpperCase()}</span>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                  {new Date(it.created_at).toLocaleString('tr-TR')} · {it.source}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 8 }}>
                {it.goal}
              </div>
              {it.result && (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: 8 }}>
                  → {it.result}
                </div>
              )}
              {it.status === 'pending' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => approveAndRun(it)} style={btn('#34d399')}>✓ ONAYLA &amp; ÇALIŞTIR</button>
                  <button onClick={() => ack(it.id, 'rejected')} style={btn('#ff8888')}>✕ REDDET</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<LocalQueueItem['status'], string> = {
  pending: '#fbbf24',
  approved: '#3b82f6',
  rejected: '#ff8888',
  done: '#34d399',
  failed: '#ff8888',
};

function btn(color: string): React.CSSProperties {
  return {
    padding: '6px 14px', fontSize: 10, letterSpacing: '0.14em',
    background: `${color}18`, border: `1px solid ${color}`, color,
    borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
    textTransform: 'uppercase', fontWeight: 700,
  };
}

