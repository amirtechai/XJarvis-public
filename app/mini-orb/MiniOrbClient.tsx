'use client';
import { BACKEND } from '@/lib/backend';

/**
 * Floating masaüstü asistan — 3D kadın avatar + chatbox.
 *
 *  - Avatar gövdesine BAS-TUT → backend PTT (/ptt/start @8766, bırakınca /ptt/stop).
 *  - Avatar'ı SÜRÜKLE → pencereyi taşı (start_orb_drag).
 *  - ÇİFT-TIK → eller-serbest sürekli dinleme (/realtime/start engine=agent).
 *  - Konuşurken (TTS) → lip-sync (metinden vizem) + el-kol jesti + göz kırpma.
 *  - Altta chatbox: yaz-gönder + akan cevap. Üstte hover'da 📌/✕.
 */
import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import * as THREE from 'three';
import { Avatar, type Phase } from './Avatar';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { useJarvisSocket, type UploadedFile } from '@/hooks/useJarvisSocket';
import { EVENT_TYPES } from '@/lib/events';

const PTT_BASE = 'http://localhost:8766';
const UPLOAD_URL = `${BACKEND}/api/upload`;
const HOLD_MS = 280;  // bundan uzun yerinde basış = PTT; kısa tap'ler çift-tık'a kalır
const DBL_MS = 360;
const DRAG_THRESHOLD = 6;

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
function invoke(cmd: string, args?: Record<string, unknown>) {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } };
  return w.__TAURI_INTERNALS__?.invoke ? w.__TAURI_INTERNALS__.invoke(cmd, args) : Promise.resolve();
}

export function MiniOrbClient() {
  const [mounted, setMounted] = useState(false);
  const { progress } = useProgress();
  const ready = progress >= 100;
  const [pttActive, setPttActive] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [ttsActive, setTtsActive] = useState(false);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [onTop, setOnTop] = useState(true);
  const [amp, setAmp] = useState(0); // canlı ses seviyesi 0..1 (VOICE_AMPLITUDE)
  const [unclear, setUnclear] = useState(false); // "net duyamadım" geri bildirimi
  const [text, setText] = useState('');
  const [chatOpen, setChatOpen] = useState(false); // false=kapalı (avatar tam görünür)
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [downServices, setDownServices] = useState<string[]>([]);
  const [startingServices, setStartingServices] = useState<string[]>([]);
  const [recovering, setRecovering] = useState(false);

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHold = useRef(false);
  const dragging = useRef(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);
  const pttRef = useRef(false);
  const handsFreeRef = useRef(false);

  const { send } = useJarvisSocket();

  useEffect(() => setMounted(true), []);

  const { lastEvent, eventHistory } = useJarvisEvents([
    EVENT_TYPES.WAKE_WORD_DETECTED,
    EVENT_TYPES.LISTENING_START,
    EVENT_TYPES.LISTENING_STOP,
    EVENT_TYPES.LISTENING_END,
    EVENT_TYPES.TTS_PLAYBACK_START,
    EVENT_TYPES.TTS_PLAYBACK_END,
    EVENT_TYPES.RESPONSE_END,
    EVENT_TYPES.QUERY_RECEIVED,
    EVENT_TYPES.RESPONSE_START,
    EVENT_TYPES.RESPONSE_CHUNK,
    EVENT_TYPES.VOICE_AMPLITUDE,
    EVENT_TYPES.STT_UNCLEAR,
  ]);

  // Konuşma geçmişi — eventHistory'den güvenilir biriktir (sesli + yazılı birlikte)
  const [convo, setConvo] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const lastProcessed = useRef<unknown>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // dipteyse otomatik kaydır; kullanıcı yukarı kaydırdıysa dokunma
  useEffect(() => {
    const idx = lastProcessed.current ? eventHistory.indexOf(lastProcessed.current as never) : -1;
    const fresh = eventHistory.slice(idx + 1);
    if (!fresh.length) return;
    lastProcessed.current = eventHistory[eventHistory.length - 1];
    setConvo((prev) => {
      const c = prev.map((x) => ({ ...x }));
      for (const ev of fresh) {
        const t = String((ev.payload as { text?: string })?.text || '');
        if (ev.event === EVENT_TYPES.QUERY_RECEIVED) {
          // file-dump'ı (\n\n---) ve [VOICE_MODE]/[tag] önekini at; çift gelirse dedup
          const u = t.split('\n\n---')[0].replace(/^\s*\[[^\]]*\]\s*/, '').trim();
          const last = c[c.length - 1];
          if (u && !(last && last.role === 'user' && last.text === u)) c.push({ role: 'user', text: u });
        } else if (ev.event === EVENT_TYPES.RESPONSE_START) {
          c.push({ role: 'assistant', text: '' });
        } else if (ev.event === EVENT_TYPES.RESPONSE_CHUNK) {
          const last = c[c.length - 1];
          if (last && last.role === 'assistant') last.text += t;
          else c.push({ role: 'assistant', text: t });
        }
      }
      return c.slice(-60);
    });
  }, [eventHistory]);

  // Yeni mesajda dibe kaydır (kullanıcı yukarı kaydırmadıysa)
  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [convo, ttsActive, speakingText]);

  // "Net duyamadım" rozeti 2.6s sonra kendiliğinden kaybolsun.
  useEffect(() => {
    if (!unclear) return;
    const t = setTimeout(() => setUnclear(false), 2600);
    return () => clearTimeout(t);
  }, [unclear]);

  useEffect(() => {
    if (!lastEvent) return;
    switch (lastEvent.event) {
      case EVENT_TYPES.WAKE_WORD_DETECTED:
      case EVENT_TYPES.LISTENING_START: setListening(true); setThinking(false); break;
      // Backend LISTENING_END yayıyor (STOP değil) — ikisini de dinle yoksa
      // orb sonsuza dek "dinliyor"da takılır (çöp/sessiz turda RESPONSE gelmez).
      case EVENT_TYPES.LISTENING_STOP:
      case EVENT_TYPES.LISTENING_END: setListening(false); setAmp(0); break;
      case EVENT_TYPES.VOICE_AMPLITUDE:
        setAmp(Math.min(1, Number((lastEvent.payload as { amplitude?: number })?.amplitude) || 0));
        break;
      case EVENT_TYPES.STT_UNCLEAR:
        setListening(false); setThinking(false); setAmp(0); setUnclear(true);
        break;
      case EVENT_TYPES.QUERY_RECEIVED: setThinking(true); break; // agent düşünüyor
      case EVENT_TYPES.RESPONSE_START: setThinking(false); break;
      case EVENT_TYPES.TTS_PLAYBACK_START:
        setTtsActive(true); setThinking(false);
        setSpeakingText(String((lastEvent.payload as { text?: string })?.text || '…'));
        break;
      case EVENT_TYPES.TTS_PLAYBACK_END:
        setTtsActive(false); setThinking(false); setSpeakingText(null);
        break;
      case EVENT_TYPES.RESPONSE_END: setThinking(false); break;
    }
  }, [lastEvent]);

  const phase: Phase = ttsActive ? 'speaking' : pttActive || handsFree || listening ? 'listening' : 'idle';
  // Ses-reaktif rim ışık rengi/temeli — konuşurken altın, dinlerken camgöbeği, boşta serin.
  const rimColor = phase === 'speaking' ? '#ffc36e' : phase === 'listening' ? '#5ae6ff' : '#b9d4ff';
  const rimBase = phase === 'speaking' ? 1.5 : phase === 'listening' ? 1.3 : 0.85;

  // ── PTT ──────────────────────────────────────────────
  const startPTT = () => {
    if (pttRef.current || handsFreeRef.current) return;
    pttRef.current = true; setPttActive(true);
    fetch(`${PTT_BASE}/ptt/start`, { method: 'POST' }).catch(() => {});
  };
  const stopPTT = () => {
    if (!pttRef.current) return;
    pttRef.current = false; setPttActive(false);
    fetch(`${PTT_BASE}/ptt/stop`, { method: 'POST' }).catch(() => {});
  };
  const toggleHandsFree = () => {
    const next = !handsFreeRef.current;
    handsFreeRef.current = next; setHandsFree(next);
    if (next) {
      // BASİT POST (JSON header YOK) → CORS preflight tetiklenmez; daemon'a ulaşır.
      // engine .env'de set değil → default 'agent' (Sonnet + tool sohbet döngüsü).
      fetch(`${PTT_BASE}/realtime/start`, { method: 'POST' }).catch(() => {});
    } else {
      fetch(`${PTT_BASE}/realtime/stop`, { method: 'POST' }).catch(() => {});
    }
  };

  // ── gesture (yerinde-tut=PTT, kaydır=taşı, çift-tap=eller-serbest) ──
  const resetGesture = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    isHold.current = false; dragging.current = false; down.current = null;
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('[data-ctl]')) return;
    resetGesture();
    down.current = { x: e.clientX, y: e.clientY };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
    holdTimer.current = setTimeout(() => { isHold.current = true; startPTT(); }, HOLD_MS);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!down.current || dragging.current || isHold.current) return;
    const dx = e.clientX - down.current.x, dy = e.clientY - down.current.y;
    if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
      dragging.current = true;
      if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
      lastTap.current = 0;
      invoke('start_orb_drag');
      down.current = null;
    }
  };
  const onUp = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    const wasHold = isHold.current, wasDrag = dragging.current;
    resetGesture();
    if (wasHold) { stopPTT(); return; }
    if (wasDrag) return;
    const now = Date.now();
    if (now - lastTap.current < DBL_MS) { lastTap.current = 0; toggleHandsFree(); }
    else { lastTap.current = now; }
  };

  const toggleOnTop = async () => { const n = !onTop; setOnTop(n); await invoke('set_mini_orb_on_top', { onTop: n }); };
  const close = async () => {
    // Kapanırken eller-serbest açıksa mic'i bırak (sızıntı: convo arkada dinlemeye devam etmesin)
    if (handsFreeRef.current) { handsFreeRef.current = false; fetch(`${PTT_BASE}/realtime/stop`, { method: 'POST' }).catch(() => {}); }
    await invoke('toggle_mini_orb', {});
  };

  // ── Sağlık takibi: kritik servis ölürse kırmızı uyarı + tek-tık toparla ──
  // Boot-grace: app açılışında servisler sırayla ayağa kalkar (voice, backend'den
  // ~15-20sn sonra). Hiç UP görülmemiş servis grace bitene dek "başlatılıyor"
  // sayılır (amber), kırmızı "kapalı" DEĞİL — her açılışta yanlış alarm veriyordu.
  // Bir kez UP görülen servis düşerse kısa flap-grace sonrası kırmızıya döner.
  useEffect(() => {
    let alive = true;
    const CRITICAL = ['agent', 'backend', 'voice'];
    const BOOT_GRACE_MS = 90_000;  // ilk açılış: agent/MCP boot'u dakikaya yaklaşabilir
    const FLAP_GRACE_MS = 12_000;  // çalışırken ölüm: 2-3 poll teyidi (tekil sahte miss'i ele)
    const seenUp = new Set<string>();
    const downSince: Record<string, number> = {};
    // Son bilinen running durumu — backend fetch fail olunca voice/agent'ın
    // durumu ÖLÇÜLEMEZ; onları körlemesine listeden düşürmek yerine son bilineni koru.
    const lastRunning: Record<string, boolean> = { agent: false, backend: false, voice: false };
    const classify = (name: string, running: boolean): 'up' | 'starting' | 'down' => {
      if (running) { seenUp.add(name); delete downSince[name]; return 'up'; }
      if (!(name in downSince)) downSince[name] = Date.now();
      const grace = seenUp.has(name) ? FLAP_GRACE_MS : BOOT_GRACE_MS;
      return Date.now() - downSince[name] >= grace ? 'down' : 'starting';
    };
    const apply = (states: Array<{ name: string; running: boolean }>) => {
      const down: string[] = []; const starting: string[] = [];
      for (const s of states) {
        const c = classify(s.name, s.running);
        if (c === 'down') down.push(s.name);
        else if (c === 'starting') starting.push(s.name);
      }
      if (alive) { setDownServices(down); setStartingServices(starting); }
    };
    const poll = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/services/state`, { cache: 'no-store' });
        const j = await r.json();
        apply(CRITICAL.map((name) => {
          const svc = (j.services || []).find((s: { name: string }) => s.name === name);
          const running = !!svc?.running;
          lastRunning[name] = running;
          return { name, running };
        }));
      } catch {
        // fetch başarısız → backend erişilemez; voice/agent DURUMU ölçülemedi →
        // onları son bilinen durumuyla değerlendir (körlemesine düşürme), backend down.
        lastRunning.backend = false;
        apply(CRITICAL.map((name) => ({
          name,
          running: name === 'backend' ? false : lastRunning[name],
        })));
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const recover = async () => {
    setRecovering(true);
    try { await fetch(`${BACKEND}/api/services/start-all`, { method: 'POST' }); } catch { /* noop */ }
    setTimeout(() => setRecovering(false), 4000);
  };
  const SVC_TR: Record<string, string> = { agent: 'Beyin', backend: 'Sunucu', voice: 'Ses', vision: 'Kamera', ui: 'Arayüz' };

  // Pencere kapanır/unmount olursa convo'yu garanti durdur (mic boşta kalmasın)
  useEffect(() => {
    const stop = () => { if (handsFreeRef.current) { try { navigator.sendBeacon(`${PTT_BASE}/realtime/stop`); } catch { /* noop */ } } };
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); };
  }, []);

  // ── Dosya yükleme (📎 / sürükle-bırak / yapıştır) ──
  const uploadFiles = async (list: FileList | File[]) => {
    setUploadError('');
    for (const file of Array.from(list)) {
      setUploading((n) => n + 1);
      try {
        const r = await fetch(`${UPLOAD_URL}?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
        const j = await r.json();
        if (j?.ok) setAttachments((a) => [...a, { name: j.name, kind: j.kind, contentPath: j.contentPath }]);
        else setUploadError(`${file.name}: ${j?.error || 'yüklenemedi'}`);
      } catch (e) {
        setUploadError(`${file.name}: bağlantı hatası`);
        console.warn('upload error', e);
      } finally { setUploading((n) => n - 1); }
    }
  };
  const removeAttachment = (i: number) => setAttachments((a) => a.filter((_, j) => j !== i));

  const sendText = () => {
    const t = text.trim();
    if (!t && attachments.length === 0) return;
    send(t, 'chat_message', attachments);
    setText(''); setAttachments([]);
  };

  // Hızlı komut çipleri — sekretere tek-tık sık kullanılan istekler.
  const QUICK = [
    { icon: '📋', label: 'Günün özeti', cmd: 'Bugün neler konuştuk? daily_digest ile günün özetini çıkar' },
    { icon: '👁', label: 'Ekranda ne var?', cmd: 'Ekrana bak ve ne olduğunu söyle' },
    { icon: '🌤', label: 'Hava', cmd: 'Bugün hava nasıl?' },
    { icon: '📰', label: 'Haberler', cmd: 'Son haberleri özetle' },
  ];
  const sendCommand = (cmd: string) => { setUnclear(false); send(cmd, 'chat_message', []); };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) { e.preventDefault(); uploadFiles(files); }
  };

  const statusLabel = ttsActive ? '💬 KONUŞUYOR' : thinking ? '💭 DÜŞÜNÜYOR' : handsFree ? '🎙 ELLER-SERBEST' : pttActive ? '● DİNLİYOR' : 'BAS-KONUŞ · ÇİFT-TIK';

  return (
    <div className="root"
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files); }}>
      {dragOver && <div className="dropzone">📂 Bırak — analiz edeyim</div>}
      {/* AVATAR ALANI (PTT / sürükle / çift-tık) */}
      <div className="stage"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        onPointerCancel={() => { if (pttRef.current) stopPTT(); resetGesture(); }}>
        {mounted && (
          <Canvas
            gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
            camera={{ position: [0, 1.4, 1.62], fov: 30 }}
            dpr={[1, 2]}
            onCreated={({ camera, gl }) => {
              camera.lookAt(0, 1.38, 0);
              // Sinematik ton eğrisi — düz/mat görünümü film-benzeri kontrasta çevirir.
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.18;
            }}
            style={{ background: 'transparent' }}>
            {/* Sinematik 3-nokta + ses-reaktif rim rig (Environment YOK → offline). */}
            <ambientLight intensity={0.5} />
            <hemisphereLight args={['#eaf2ff', '#241f33', 0.5]} />
            {/* KEY — sıcak, sağ üst (yüzü modelleyen ana ışık) */}
            <directionalLight position={[2.6, 3.2, 2.6]} intensity={2.05} color="#fff3e2" />
            {/* FILL — serin, sol yumuşak (gölge derinliğini kaldırır) */}
            <directionalLight position={[-2.8, 1.1, 1.9]} intensity={0.65} color="#9ec5ff" />
            {/* RIM/KICKER — arkadan, ses-reaktif: saç+omuz konturunu parlatır, premium ayrışma */}
            <directionalLight
              position={[-1.4, 2.7, -3.2]}
              intensity={rimBase + amp * 1.9}
              color={rimColor}
            />
            {/* göze catch-light — canlılık */}
            <pointLight position={[0, 1.52, 1.35]} intensity={0.3} color="#ffffff" />
            <Suspense fallback={null}>
              <Avatar phase={phase} speakingText={speakingText} />
            </Suspense>
          </Canvas>
        )}

        {!ready && <div className="loading"><span /><span /><span /></div>}

        {/* Canlı ses-nabzı — sen konuşurken sesinle parlar/büyür */}
        {(pttActive || handsFree || listening) && (
          <div className="voicepulse" style={{
            transform: `translate(-50%, -50%) scale(${(0.65 + amp * 0.8).toFixed(3)})`,
            opacity: (0.22 + amp * 0.78).toFixed(3),
            background: `radial-gradient(circle, ${handsFree ? 'rgba(255,120,220,0.5)' : 'rgba(90,230,255,0.5)'} 0%, transparent 62%)`,
          }} />
        )}

        {/* durum rozeti */}
        <div className={`status ${phase}${thinking ? ' thinking' : ''}`}>{statusLabel}</div>

        {/* Nazik "net duyamadım" geri bildirimi (konuşuldu ama anlaşılamadı) */}
        {unclear && <div className="unclear">🤔 Net duyamadım — tekrar eder misin Patron?</div>}

        {/* Sağlık uyarısı — kritik servis kapalıysa */}
        {downServices.length > 0 && (
          <div data-ctl className="health" onPointerDown={(e) => e.stopPropagation()}>
            <span>⚠️ {downServices.map((s) => SVC_TR[s] || s).join(', ')} kapalı</span>
            <button data-ctl onClick={(e) => { e.stopPropagation(); recover(); }} disabled={recovering}>
              {recovering ? '↻…' : '↻ Toparla'}
            </button>
          </div>
        )}
        {downServices.length === 0 && startingServices.length > 0 && (
          <div data-ctl className="health starting" onPointerDown={(e) => e.stopPropagation()}>
            <span>⏳ {startingServices.map((s) => SVC_TR[s] || s).join(', ')} başlatılıyor…</span>
          </div>
        )}

        {/* kontroller (hover) */}
        <div data-ctl className="ctl">
          <button data-ctl onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleOnTop(); }}
            title={onTop ? 'Üstte: AÇIK' : 'Üstte: KAPALI'} style={btn(onTop)}>📌</button>
          <button data-ctl onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); close(); }}
            title="Gizle" style={btn(false)}>✕</button>
        </div>
      </div>

      {/* CHATBOX */}
      <div className={`chat${chatOpen ? ' open' : ''}`}>
        {/* Aç/kapat — kapalıyken avatar tam görünür, açıkken geçmiş */}
        <button className="chattoggle" onClick={() => setChatOpen((v) => !v)}
          title={chatOpen ? 'Sohbeti küçült (sekreteri gör)' : 'Sohbet geçmişini aç'}>
          {chatOpen ? '⌄  küçült' : '⌃  geçmiş'}
        </button>
        {chatOpen ? (
          <div className="log" ref={logRef}
            onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
            {convo.length === 0
              ? <div className="hint">Merhaba Patron — gövdeme basılı tutup konuş, ya da yaz.</div>
              : convo.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.text || '…'}</div>)}
          </div>
        ) : (
          <div className="lastline">
            {ttsActive && speakingText ? speakingText
              : convo.length ? convo[convo.length - 1].text
              : 'Merhaba Patron — bas-konuş ya da yaz.'}
          </div>
        )}
        {/* Ekler (chips) */}
        {(attachments.length > 0 || uploading > 0 || uploadError) && (
          <div className="chips">
            {attachments.map((a, i) => (
              <span key={i} className="chip" title={a.contentPath}>
                {a.kind === 'image' ? '🖼' : '📄'} {a.name.length > 18 ? a.name.slice(0, 16) + '…' : a.name}
                <button className="chipx" onClick={() => removeAttachment(i)} title="Kaldır">✕</button>
              </span>
            ))}
            {uploading > 0 && <span className="chip up">⏳ {uploading} yükleniyor…</span>}
            {uploadError && (
              <span className="chip err" title={uploadError}>⚠️ {uploadError.slice(0, 28)}
                <button className="chipx" onClick={() => setUploadError('')} title="Kapat">✕</button>
              </span>
            )}
          </div>
        )}
        {/* Hızlı komut çipleri — sekretere tek-tık sık istekler */}
        <div className="quickrow">
          {QUICK.map((q) => (
            <button key={q.label} className="quick" title={q.cmd}
              onClick={() => sendCommand(q.cmd)}>
              <span className="qi">{q.icon}</span>{q.label}
            </button>
          ))}
        </div>
        <div className="inputrow">
          <input ref={fileInput} type="file" multiple hidden
            onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ''; }} />
          <button className="attach" onClick={() => fileInput.current?.click()} title="Dosya / görsel / video ekle">📎</button>
          <input value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === 'Enter') sendText(); }}
            placeholder="Mesaj yaz, dosya sürükle/yapıştır…" />
          <button onClick={sendText} title="Gönder">➤</button>
        </div>
      </div>

      <style>{`
        html, body { background: transparent !important; margin: 0; overflow: hidden; }
        body::before, body::after { display: none !important; content: none !important; } /* aurora/vignette kapat — şeffaf pencere */
        .root { position: fixed; inset: 0; overflow: hidden; background: transparent;
          user-select: none; -webkit-user-select: none; font-family: var(--font-hud, ui-sans-serif, system-ui); }
        /* Avatar TAM BOY (stage full); chatbox alta overlay olur ama yüzü kapatmaz
           (kapasiteli + aç/kapat). Avatar küçülmez. */
        .stage { position: absolute; inset: 0; cursor: grab; touch-action: none; }
        .stage:active { cursor: grabbing; }
        .stage canvas { pointer-events: none; width: 100% !important; height: 100% !important; }
        .voicepulse { position: absolute; top: 44%; left: 50%; width: 66%; height: 66%; border-radius: 50%;
          pointer-events: none; mix-blend-mode: screen; filter: blur(7px); z-index: 2;
          transition: transform .07s linear, opacity .1s linear; }
        .loading { position: absolute; inset: 0; display: flex; gap: 6px; align-items: center; justify-content: center; }
        .loading span { width: 8px; height: 8px; border-radius: 50%; background: #6fd0ff;
          animation: lp 1s ease-in-out infinite; }
        .loading span:nth-child(2){ animation-delay:.15s } .loading span:nth-child(3){ animation-delay:.3s }
        @keyframes lp { 0%,100%{ opacity:.25; transform:translateY(0) } 50%{ opacity:1; transform:translateY(-5px) } }
        .status { position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
          padding: 3px 11px; border-radius: 999px; font-size: 8.5px; letter-spacing: .14em; font-weight: 800;
          white-space: nowrap; backdrop-filter: blur(6px); opacity: 0; transition: opacity .25s; pointer-events: none;
          background: rgba(8,18,30,.5); border: 1px solid rgba(120,200,255,.35); color: #bfe2ff; }
        .status.speaking { background: rgba(40,120,90,.5); border-color: rgba(92,255,192,.6); color: #aaffd9; opacity: 1; }
        .status.listening { background: rgba(125,33,145,.5); border-color: rgba(255,134,228,.6); color: #ffc6f2; opacity: 1; }
        .status.thinking { background: rgba(70,90,140,.5); border-color: rgba(150,180,255,.6); color: #cdd9ff; opacity: 1; }
        .health { position: absolute; top: 6px; left: 6px; z-index: 11; display: flex; align-items: center; gap: 6px;
          padding: 3px 4px 3px 9px; border-radius: 999px; font-size: 9px; font-weight: 700; white-space: nowrap;
          background: rgba(150,30,30,.62); border: 1px solid rgba(255,90,90,.7); color: #ffd9d9; backdrop-filter: blur(6px); }
        .health button { border: none; border-radius: 999px; cursor: pointer; font-size: 8.5px; font-weight: 800;
          padding: 3px 8px; background: rgba(255,255,255,.92); color: #a11; }
        .health button:disabled { opacity: .6; cursor: default; }
        .health.starting { background: rgba(140,100,20,.55); border-color: rgba(255,190,80,.6); color: #ffe9c2; padding-right: 9px; }
        .unclear { position: absolute; top: 34px; left: 50%; transform: translateX(-50%); z-index: 11;
          padding: 4px 12px; border-radius: 999px; font-size: 10px; font-weight: 700; white-space: nowrap;
          background: rgba(150,110,30,.6); border: 1px solid rgba(255,200,90,.65); color: #ffe8bf;
          backdrop-filter: blur(6px); animation: unclearpop .28s ease; }
        @keyframes unclearpop { from { opacity: 0; transform: translate(-50%, -4px); } to { opacity: 1; transform: translate(-50%, 0); } }
        .quickrow { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; }
        .quick { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-size: 9.5px; font-weight: 700;
          padding: 4px 9px; border-radius: 999px; color: #cfe0f5; white-space: nowrap;
          background: rgba(120,170,255,.12); border: 1px solid rgba(140,190,255,.26); transition: background .16s, border-color .16s; }
        .quick:hover { background: rgba(120,170,255,.24); border-color: rgba(160,205,255,.5); }
        .quick .qi { font-size: 11px; }
        .stage:hover .status { opacity: 1; }
        .ctl { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; z-index: 10; opacity: 0; transition: opacity .2s; }
        .stage:hover .ctl { opacity: 1; }
        .chat { position: absolute; left: 0; right: 0; bottom: 0; min-width: 0; padding: 8px; display: flex; flex-direction: column; gap: 7px;
          background: linear-gradient(180deg, rgba(10,16,26,0) 0%, rgba(10,16,26,.82) 28%);
          backdrop-filter: blur(7px); }
        .chattoggle { align-self: center; cursor: pointer; font-size: 9px; font-weight: 800; letter-spacing: .12em;
          padding: 2px 14px; border-radius: 999px; color: #bfe2ff; background: rgba(120,170,255,.2);
          border: 1px solid rgba(140,190,255,.32); }
        .lastline { font-size: 11.5px; line-height: 1.4; color: #dce8f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          background: rgba(255,255,255,.06); border: 1px solid rgba(140,190,255,.18); border-radius: 12px; padding: 6px 10px; }
        .log { max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; padding: 2px; }
        .log::-webkit-scrollbar { width: 5px; }
        .log::-webkit-scrollbar-thumb { background: rgba(140,190,255,.4); border-radius: 3px; }
        .hint { font-size: 11.5px; color: #9fb6c9; padding: 6px 8px; }
        .msg { font-size: 11.5px; line-height: 1.45; white-space: normal; overflow-wrap: anywhere;
          border-radius: 12px; padding: 6px 10px; max-width: 86%; }
        .msg.user { align-self: flex-end; background: rgba(90,130,255,.22);
          border: 1px solid rgba(120,160,255,.35); color: #eaf0ff; border-bottom-right-radius: 4px; }
        .msg.assistant { align-self: flex-start; background: rgba(255,255,255,.07);
          border: 1px solid rgba(140,190,255,.2); color: #dce8f5; border-bottom-left-radius: 4px; }
        .inputrow { display: flex; gap: 6px; min-width: 0; }
        .inputrow input { flex: 1; min-width: 0; background: rgba(255,255,255,.07); border: 1px solid rgba(140,190,255,.22);
          border-radius: 10px; padding: 7px 11px; color: #eaf2ff; font-size: 12px; outline: none; }
        .inputrow input::placeholder { color: #6f8299; }
        .inputrow button { width: 36px; flex: 0 0 auto; border: none; border-radius: 10px; cursor: pointer; font-size: 13px;
          background: linear-gradient(135deg, #3aa0ff, #6f7bff); color: #fff; }
        .inputrow button.attach { background: rgba(255,255,255,.09); }
        .chips { display: flex; flex-wrap: wrap; gap: 5px; }
        .chip { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; color: #cfe0f2; max-width: 100%;
          background: rgba(120,170,255,.14); border: 1px solid rgba(140,190,255,.3); border-radius: 999px; padding: 3px 4px 3px 9px; }
        .chip.up { color: #ffd98a; border-color: rgba(255,200,100,.4); padding-right: 9px; }
        .chip.err { color: #ffb3b3; background: rgba(255,90,90,.16); border-color: rgba(255,120,120,.5); }
        .chipx { width: 15px; height: 15px; border: none; border-radius: 50%; cursor: pointer; font-size: 8px; flex: 0 0 auto;
          background: rgba(255,255,255,.14); color: #eaf2ff; display: inline-flex; align-items: center; justify-content: center; }
        .dropzone { position: absolute; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
          font-size: 15px; font-weight: 800; color: #bfe9ff; letter-spacing: .03em; text-align: center;
          background: rgba(8,26,52,.55); border: 2px dashed rgba(120,200,255,.7); border-radius: 14px; backdrop-filter: blur(4px); }
      `}</style>
    </div>
  );
}

function btn(active: boolean): React.CSSProperties {
  return {
    width: 22, height: 22, fontSize: 10,
    background: active ? 'rgba(0,212,255,0.28)' : 'rgba(8,22,34,0.55)',
    border: `1px solid ${active ? 'rgba(0,212,255,0.65)' : 'rgba(255,255,255,0.22)'}`,
    color: active ? '#9fe9ff' : '#cfd9e4', borderRadius: 8, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)',
  };
}
