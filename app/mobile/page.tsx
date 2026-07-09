'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MobileStatusStrip } from './MobileStatusStrip';

interface Msg { role: 'user' | 'assistant'; content: string; }
type VoiceState = 'wake' | 'listening' | 'speaking' | 'idle';

const N_BARS = 24;
const SZ = 300;
const CX = 150;
const CY = 150;

const MJ = [0, 90, 180, 270];
const MN = [30, 60, 120, 150, 210, 240, 300, 330];
const SM = [10,20,40,50,70,80,100,110,130,140,160,170,190,200,220,230,250,260,280,290,310,320,340,350];

const r2 = (deg: number) => (deg - 90) * Math.PI / 180;
const ap = (r: number, a1: number, a2: number) => {
  const x1 = (CX + r * Math.cos(r2(a1))).toFixed(1);
  const y1 = (CY + r * Math.sin(r2(a1))).toFixed(1);
  const x2 = (CX + r * Math.cos(r2(a2))).toFixed(1);
  const y2 = (CY + r * Math.sin(r2(a2))).toFixed(1);
  return `M${x1} ${y1} A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2} ${y2}`;
};
const ptx = (r: number, a: number) => (CX + r * Math.cos(r2(a))).toFixed(1);
const pty = (r: number, a: number) => (CY + r * Math.sin(r2(a))).toFixed(1);

function hasJarvis(text: string): boolean {
  return /(?:hey\s*)?[jygc]ar[vb][iıîşs]/i.test(text);
}

function getCommandAfterJarvis(text: string): string {
  const m = text.match(/(?:hey\s*)?[jygc]ar[vb]\w*/i);
  if (!m || m.index === undefined) return '';
  return text.slice(m.index + m[0].length).trim();
}

function truncateForTTS(text: string, maxLen = 800): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const last = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('\n'),
  );
  return last > 100 ? slice.slice(0, last + 1) : slice + '…';
}

function extractImages(text: string): string[] {
  const urls: string[] = [];
  const mdReg = /!\[.*?\]\((https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^)]*)?)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = mdReg.exec(text)) !== null) urls.push(m[1]);
  const plainReg = /(https?:\/\/[^\s"'<>\]]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s"'<>\]]*)?)/gi;
  while ((m = plainReg.exec(text)) !== null) {
    if (!urls.includes(m[1])) urls.push(m[1]);
  }
  return [...new Set(urls)];
}

function HudSvg({ c }: { c: string }) {
  const rgb = c === '#00ff88' ? '0,255,136' : c === '#ff9f0a' ? '255,159,10' : '0,212,255';
  return (
    <svg width={SZ} height={SZ} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      <path d={ap(156, 4, 87)} fill="none" stroke="#00d4ff" strokeWidth="3" opacity="0.52" strokeLinecap="round" />
      <path d={ap(156, 93, 176)} fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0.28" strokeLinecap="round" />
      <path d={ap(156, 184, 267)} fill="none" stroke="#00d4ff" strokeWidth="3" opacity="0.52" strokeLinecap="round" />
      <path d={ap(156, 273, 356)} fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0.28" strokeLinecap="round" />
      {[0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270,285,300,315,330,345].map(a => (
        <line key={a} x1={ptx(148,a)} y1={pty(148,a)} x2={ptx(158,a)} y2={pty(158,a)}
          stroke="#00d4ff" strokeWidth={MJ.includes(a) ? 2.2 : 0.8} opacity={MJ.includes(a) ? 0.8 : 0.22} />
      ))}
      <circle cx={CX} cy={CY} r="143" fill="none" stroke="#00d4ff" strokeWidth="0.4" opacity="0.1" />
      <circle cx={CX} cy={CY} r="136" fill="none" stroke="#00d4ff" strokeWidth="0.7" opacity="0.15" strokeDasharray="2 4" />
      <circle cx={CX} cy={CY} r="128" fill="none" stroke={`rgba(${rgb},0.07)`} strokeWidth="6" />
      <path d={ap(128, 0, 215)} fill="none" stroke={c} strokeWidth="6" opacity="0.35" strokeLinecap="round" />
      <path d={ap(128, 0, 215)} fill="none" stroke={c} strokeWidth="1.2" opacity="0.9" strokeLinecap="round" />
      <circle cx={CX} cy={CY} r="121" fill="none" stroke="#00d4ff" strokeWidth="1.8" opacity="0.65" />
      {MJ.map(a => <line key={a} x1={ptx(121,a)} y1={pty(121,a)} x2={ptx(102,a)} y2={pty(102,a)} stroke="#00d4ff" strokeWidth="2.8" opacity="0.92" />)}
      {MN.map(a => <line key={a} x1={ptx(121,a)} y1={pty(121,a)} x2={ptx(110,a)} y2={pty(110,a)} stroke="#00d4ff" strokeWidth="1.6" opacity="0.65" />)}
      {SM.map(a => <line key={a} x1={ptx(121,a)} y1={pty(121,a)} x2={ptx(116,a)} y2={pty(116,a)} stroke="#00d4ff" strokeWidth="0.7" opacity="0.22" />)}
      <text x={CX} y={CY - 125} textAnchor="middle" fontSize="7.5" fill="#00d4ff" opacity="0.55" fontFamily="Courier New,monospace">000°</text>
      <text x={CX + 127} y={CY + 3} textAnchor="start" fontSize="7.5" fill="#00d4ff" opacity="0.55" fontFamily="Courier New,monospace">090°</text>
      <text x={CX} y={CY + 135} textAnchor="middle" fontSize="7.5" fill="#00d4ff" opacity="0.55" fontFamily="Courier New,monospace">180°</text>
      <text x={CX - 127} y={CY + 3} textAnchor="end" fontSize="7.5" fill="#00d4ff" opacity="0.55" fontFamily="Courier New,monospace">270°</text>
      <path d={ap(113, 12, 52)} fill="none" stroke={`rgba(${rgb},0.15)`} strokeWidth="4.5" />
      <path d={ap(113, 12, 40)} fill="none" stroke={c} strokeWidth="4.5" opacity="0.72" strokeLinecap="round" />
      <path d={ap(113, 62, 102)} fill="none" stroke={`rgba(${rgb},0.15)`} strokeWidth="4.5" />
      <path d={ap(113, 62, 86)} fill="none" stroke={c} strokeWidth="4.5" opacity="0.52" strokeLinecap="round" />
      <path d={ap(113, 192, 232)} fill="none" stroke={`rgba(${rgb},0.15)`} strokeWidth="4.5" />
      <path d={ap(113, 192, 220)} fill="none" stroke={c} strokeWidth="4.5" opacity="0.72" strokeLinecap="round" />
      <path d={ap(113, 242, 282)} fill="none" stroke={`rgba(${rgb},0.15)`} strokeWidth="4.5" />
      <path d={ap(113, 242, 266)} fill="none" stroke={c} strokeWidth="4.5" opacity="0.52" strokeLinecap="round" />
      <circle cx={CX} cy={CY} r="104" fill="none" stroke="#00d4ff" strokeWidth="0.7" opacity="0.18" />
      <circle cx={CX} cy={CY} r="93" fill="rgba(0,10,24,0.94)" stroke="#00d4ff" strokeWidth="1.8" opacity="0.65" />
      <path d={ap(87, 135, 178)} fill="none" stroke="#00d4ff" strokeWidth="1.2" opacity="0.3" />
      <path d={ap(87, 315, 358)} fill="none" stroke="#00d4ff" strokeWidth="1.2" opacity="0.3" />
      <circle cx={CX} cy={CY} r="77" fill="rgba(0,3,10,0.97)" stroke="#00d4ff" strokeWidth="0.6" opacity="0.28" />
      <line x1={CX - 11} y1={CY} x2={CX + 11} y2={CY} stroke="#00d4ff" strokeWidth="0.9" opacity="0.45" />
      <line x1={CX} y1={CY - 11} x2={CX} y2={CY + 11} stroke="#00d4ff" strokeWidth="0.9" opacity="0.45" />
      <circle cx={CX} cy={CY} r="4.5" fill={c} opacity="0.95" />
      <circle cx={CX} cy={CY} r="9" fill="none" stroke={c} strokeWidth="1.2" opacity="0.5" />
      <circle cx={CX} cy={CY} r="16" fill="none" stroke="#00d4ff" strokeWidth="0.5" opacity="0.18" />
    </svg>
  );
}

export default function MobilePage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [host, setHost] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [volume, setVolume] = useState(0.9);
  const [hudScale, setHudScale] = useState(1);
  const [speechBuf, setSpeechBuf] = useState('');
  const [interimText, setInterimText] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const msgBoxRef = useRef<HTMLDivElement>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamBufRef = useRef('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const modeRef = useRef<'wake' | 'command'>('wake');
  const suppressRestartRef = useRef(false);
  const voiceStateRef = useRef<VoiceState>('idle');
  const speakGenRef = useRef(0);
  const volumeRef = useRef(0.9);
  const ttsEnabledRef = useRef(true);
  const connectRef = useRef<() => void>(() => {});
  const sendMsgRef = useRef<(content: string) => void>(() => {});
  const commandStartIndexRef = useRef(-1);
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechAccumRef = useRef('');

  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

  const setVS = useCallback((s: VoiceState) => {
    voiceStateRef.current = s;
    setVoiceState(s);
  }, []);

  const resetSession = useCallback(() => {
    if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
    sessionTimeoutRef.current = setTimeout(() => {
      modeRef.current = 'wake';
      setVS('wake');
    }, 25000);
  }, [setVS]);

  // Responsive HUD: scale to fit — leaves room for image panel + response box + UI chrome
  useEffect(() => {
    const calc = () => {
      // fixed chrome: header~50 + scanbar~2 + inputrow~60 + volbar~22 + bottombtns~52 = ~186
      // plus paddingTop 44 + gap 10 + response box 240 + gap 10 = 304
      // total margin ~490
      const avH = window.innerHeight - 490;
      const avW = window.innerWidth - 32;
      setHudScale(Math.max(0.45, Math.min(1, Math.min(avH, avW) / SZ)));
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const h = url.searchParams.get('host') ?? url.hostname;
    setHost(h);
  }, []);

  // Extract image from latest assistant message
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') {
      const imgs = extractImages(last.content);
      if (imgs.length > 0) setImageUrl(imgs[0]);
    }
  }, [messages]);

  // Auto-scroll response box
  useEffect(() => {
    msgBoxRef.current?.scrollTo({ top: msgBoxRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, speechBuf, interimText]);

  const speak = useCallback((text: string) => {
    if (!synthesisRef.current || !ttsEnabledRef.current) return;
    const gen = ++speakGenRef.current;
    const utt = new SpeechSynthesisUtterance(truncateForTTS(text));
    utt.lang = 'tr-TR';
    utt.rate = 1.05;
    utt.volume = volumeRef.current;

    // Keep STT alive during TTS so "dur jarvis" can be detected
    suppressRestartRef.current = true;

    setVS('speaking');
    synthesisRef.current.cancel();

    utt.onend = () => {
      if (speakGenRef.current !== gen) return;
      suppressRestartRef.current = false;
      modeRef.current = 'command';
      setVS('listening');
      resetSession();
      setTimeout(() => {
        if (!suppressRestartRef.current) {
          try { recognitionRef.current?.start(); } catch { /* already running */ }
        }
      }, 700);
    };
    utt.onerror = () => {
      if (speakGenRef.current !== gen) return;
      suppressRestartRef.current = false;
      modeRef.current = 'command';
      setVS('listening');
      resetSession();
      setTimeout(() => {
        if (!suppressRestartRef.current) {
          try { recognitionRef.current?.start(); } catch { /* ignore */ }
        }
      }, 500);
    };

    synthesisRef.current.speak(utt);
  }, [setVS, resetSession]);

  const sendMessage = useCallback((content: string) => {
    if (!content.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    synthesisRef.current?.cancel();
    ++speakGenRef.current;
    streamBufRef.current = '';
    setInput('');
    speechAccumRef.current = '';
    setSpeechBuf('');
    setInterimText('');
    setMessages(prev => [...prev, { role: 'user', content: content.trim() }]);
    wsRef.current.send(JSON.stringify({ type: 'chat_message', content: content.trim() }));
    resetSession();
  }, [resetSession]);

  sendMsgRef.current = sendMessage;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    setVoiceSupported(true);
    synthesisRef.current = window.speechSynthesis;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'tr-TR';
    recognitionRef.current = rec;

    rec.onstart = () => {
      if (!suppressRestartRef.current) {
        setVS(modeRef.current === 'command' ? 'listening' : 'wake');
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const t = result[0].transcript.toLowerCase().trim();
        const isFinal = result.isFinal;

        // "dur jarvis" interrupt while TTS is speaking — check first
        if (voiceStateRef.current === 'speaking') {
          if (isFinal && /\bdur(\s*(jarvis|bak))?\b|\bstop\b|\biptal\b/i.test(t)) {
            synthesisRef.current?.cancel();
            ++speakGenRef.current;
            suppressRestartRef.current = false;
            modeRef.current = 'command';
            setVS('listening');
            speechAccumRef.current = '';
            setSpeechBuf('');
            setInterimText('');
          }
          continue; // ignore all other input while TTS is playing
        }

        if (modeRef.current === 'wake') {
          if (hasJarvis(t)) {
            commandStartIndexRef.current = i;
            const cmd = getCommandAfterJarvis(t);
            if (cmd.length > 2 && isFinal) {
              sendMsgRef.current(cmd);
            } else {
              modeRef.current = 'command';
              setVS('listening');
            }
          }
        } else if (modeRef.current === 'command') {
          if (!isFinal) {
            setInterimText(t);
            continue;
          }
          setInterimText('');

          // Skip the result that contains the wake word itself
          if (i === commandStartIndexRef.current) {
            const cmd = getCommandAfterJarvis(result[0].transcript);
            if (cmd.length > 2) {
              speechAccumRef.current = cmd + ' ';
              setSpeechBuf(cmd);
            }
            continue;
          }

          const transcript = result[0].transcript.trim();
          if (!transcript) continue;

          // "okey" / "tamam" / "gönder" triggers send of accumulated speech
          const okeyMatch = transcript.match(/^(.*?)\b(okey|okay|tamam|gönder)\b.*$/i);
          if (okeyMatch) {
            const before = okeyMatch[1].trim();
            const toSend = (speechAccumRef.current + (before ? before + ' ' : '')).trim();
            speechAccumRef.current = '';
            setSpeechBuf('');
            if (toSend) sendMsgRef.current(toSend);
          } else {
            speechAccumRef.current += transcript + ' ';
            setSpeechBuf(speechAccumRef.current.trim());
          }
        }
      }
    };

    rec.onend = () => {
      if (suppressRestartRef.current) return;
      setTimeout(() => {
        if (!suppressRestartRef.current) {
          try { rec.start(); } catch { /* already running */ }
        }
      }, 300);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed') {
        setMicDenied(true);
        setVS('idle');
        return;
      }
      if (e.error === 'no-speech') return;
      if (suppressRestartRef.current) return;
      modeRef.current = 'wake';
      setTimeout(() => {
        if (!suppressRestartRef.current) {
          try { rec.start(); } catch { /* ignore */ }
        }
      }, 2000);
    };

    try { rec.start(); } catch { /* ignore */ }
    return () => {
      suppressRestartRef.current = true;
      try { rec.stop(); } catch { /* ignore */ }
      if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setVS]);

  const toggleVoice = useCallback(() => {
    if (!voiceSupported || micDenied) return;
    const vs = voiceStateRef.current;
    if (vs === 'listening') {
      modeRef.current = 'wake';
      setVS('wake');
    } else if (vs === 'wake') {
      modeRef.current = 'command';
      setVS('listening');
    }
  }, [voiceSupported, micDenied, setVS]);

  const connect = useCallback(() => {
    if (!host) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(`ws://${host}:3001`);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
    ws.onclose = () => {
      setConnected(false);
      reconnectRef.current = setTimeout(() => connectRef.current(), 3000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'stream_chunk') {
        setStreaming(true);
        streamBufRef.current += msg.content;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: last.content + msg.content }];
          }
          return [...prev, { role: 'assistant', content: msg.content }];
        });
      }
      if (msg.type === 'stream_end') {
        setStreaming(false);
        const full = streamBufRef.current;
        streamBufRef.current = '';
        if (full.length > 0) speak(full);
      }
    };
  }, [host, speak]);

  connectRef.current = connect;

  useEffect(() => {
    if (host) connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [host, connect]);

  useEffect(() => {
    if (showChat) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, showChat]);

  const send = useCallback(() => { sendMessage(input); }, [input, sendMessage]);

  // Push-to-talk: hold button → force listening; release → send accumulated buf
  const pttDown = useCallback(() => {
    if (!voiceSupported || micDenied || !connected) return;
    speechAccumRef.current = '';
    setSpeechBuf('');
    setInterimText('');
    modeRef.current = 'command';
    setVS('listening');
    try { recognitionRef.current?.start(); } catch { /* already running */ }
  }, [voiceSupported, micDenied, connected, setVS]);

  const pttUp = useCallback(() => {
    const text = (speechAccumRef.current || '').trim();
    speechAccumRef.current = '';
    setSpeechBuf('');
    setInterimText('');
    modeRef.current = 'wake';
    setVS('wake');
    if (text) sendMessage(text);
  }, [sendMessage, setVS]);

  const reconnect = useCallback(() => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    wsRef.current?.close();
    setTimeout(() => connectRef.current(), 150);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    streamBufRef.current = '';
    speechAccumRef.current = '';
    setSpeechBuf('');
    setInterimText('');
    setImageUrl(null);
  }, []);

  const waveActive = voiceState === 'listening' || voiceState === 'speaking' || streaming;
  const waveColor = voiceState === 'listening' ? '#00ff88' : voiceState === 'speaking' ? '#ff9f0a' : '#00d4ff';
  const statusText =
    voiceState === 'listening' ? 'DİNLİYORUM' :
    voiceState === 'speaking' ? 'KONUŞUYORUM' :
    streaming ? 'İŞLİYORUM' :
    voiceState === 'wake' ? 'BEKLIYORUM' :
    connected ? 'HAZIR' : 'BAĞLANIYOR';
  const scanSpeed = waveActive ? '2.5s' : '8s';
  const volPct = Math.round(volume * 100);

  const recentMsgs = messages.slice(-4);
  const hasContent = recentMsgs.length > 0 || speechBuf || interimText;

  const bottomBtns = [
    { icon: '⊗', label: 'CLR', title: 'Konuşmayı temizle', action: clearMessages, active: false },
    { icon: '↺', label: 'SYNC', title: 'Yeniden bağlan', action: reconnect, active: !connected },
    { icon: ttsEnabled ? '🔊' : '🔇', label: 'TTS', title: 'Sesi aç/kapat', action: () => setTtsEnabled(v => !v), active: !ttsEnabled },
    { icon: showChat ? '◉' : '≡', label: 'CHAT', title: 'Sohbet görünümü', action: () => setShowChat(v => !v), active: showChat },
  ];

  return (
    <>
      <MobileStatusStrip />
      <style>{`
        * { box-sizing: border-box; }
        @keyframes waveBar {
          0%, 100% { transform: scaleY(0.1); }
          50% { transform: scaleY(1); }
        }
        @keyframes idleBar {
          0%, 100% { transform: scaleY(0.07); }
          50% { transform: scaleY(0.18); }
        }
        @keyframes scanArc { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes onlineDot {
          0%, 100% { box-shadow: 0 0 5px #00ff88; }
          50% { box-shadow: 0 0 14px #00ff88, 0 0 26px rgba(0,255,136,0.45); }
        }
        @keyframes statusBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        @keyframes cornerBlink {
          0%, 92%, 100% { opacity: 0.38; }
          94% { opacity: 0.08; }
          97% { opacity: 0.55; }
        }
        @keyframes hudGlow {
          0%, 100% { filter: drop-shadow(0 0 6px rgba(var(--hud-rgb),0.4)); }
          50% { filter: drop-shadow(0 0 14px rgba(var(--hud-rgb),0.7)); }
        }
        @keyframes imgFadeIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .hud-btn { touch-action: manipulation; }
        .hud-btn:active { transform: scale(0.88) !important; filter: brightness(1.6) !important; }
        .hud-input::placeholder { color: rgba(var(--hud-rgb),0.28); }
        .hud-input:focus { outline: none; border-color: rgba(var(--hud-rgb),0.75) !important; box-shadow: 0 0 14px rgba(var(--hud-rgb),0.22) !important; }
        .chat-scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
        .chat-scroll::-webkit-scrollbar { width: 3px; }
        .chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(var(--hud-rgb),0.3); border-radius: 2px; }
        .data-flicker { animation: cornerBlink 7s ease-in-out infinite; }
        .msg-box-scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
        .msg-box-scroll::-webkit-scrollbar { width: 2px; }
        .msg-box-scroll::-webkit-scrollbar-thumb { background: rgba(var(--hud-rgb),0.25); border-radius: 2px; }
      `}</style>

      <div style={{
        display: 'flex', flexDirection: 'column',
        height: '100dvh',
        background: 'radial-gradient(ellipse at 50% 35%, #041e30 0%, #01111e 55%, #000a14 100%)',
        fontFamily: '"Courier New", Courier, monospace',
        color: '#00d4ff',
        overflow: 'hidden',
        userSelect: 'none',
      }}>

        {/* Header */}
        <div style={{
          padding: '8px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(var(--hud-rgb),0.2)',
          background: 'linear-gradient(180deg, rgba(0,20,40,0.95) 0%, rgba(0,12,28,0.85) 100%)',
          flexShrink: 0, gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 72 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: connected ? '#00ff88' : '#ff453a',
              animation: connected ? 'onlineDot 2.2s infinite' : 'none',
            }} />
            <span style={{ fontSize: 8.5, letterSpacing: 2, color: connected ? '#00ff88' : '#ff453a' }}>
              {connected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>

          <span style={{
            fontSize: 16, fontWeight: 900, letterSpacing: 7,
            color: '#00d4ff',
            textShadow: '0 0 16px #00d4ff, 0 0 32px rgba(var(--hud-rgb),0.5)',
            flex: 1, textAlign: 'center',
          }}>
            J·A·R·V·I·S
          </span>

          <button className="hud-btn" onClick={() => setShowChat(v => !v)} style={{
            background: showChat ? 'rgba(var(--hud-rgb),0.14)' : 'transparent',
            border: '1px solid rgba(var(--hud-rgb),0.42)',
            borderRadius: 4, color: '#00d4ff',
            padding: '5px 10px', fontSize: 9, letterSpacing: 1.5,
            cursor: 'pointer', minWidth: 54, textAlign: 'center', transition: 'all 0.15s',
          }}>
            {showChat ? '◉ HUD' : '≡ CHAT'}
          </button>
        </div>

        {/* Scan bar */}
        <div style={{
          height: 2, background: 'transparent',
          borderBottom: '1px solid rgba(var(--hud-rgb),0.12)',
          flexShrink: 0, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, height: '100%', width: '30%',
            background: 'linear-gradient(90deg, transparent, rgba(var(--hud-rgb),0.6), transparent)',
            animation: 'scanArc 3s linear infinite',
          }} />
        </div>

        {/* Main area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Chat view */}
          {showChat && (
            <div ref={listRef} className="chat-scroll" style={{
              position: 'absolute', inset: 0, zIndex: 10,
              background: 'rgba(1,8,18,0.97)',
              padding: '14px',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: 'rgba(var(--hud-rgb),0.3)', fontSize: 13, paddingTop: 60, letterSpacing: 3 }}>
                  — SİSTEM HAZIR —
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '85%',
                    background: m.role === 'user' ? 'rgba(0,90,180,0.28)' : 'rgba(var(--hud-rgb),0.07)',
                    border: `1px solid ${m.role === 'user' ? 'rgba(0,130,255,0.5)' : 'rgba(var(--hud-rgb),0.28)'}`,
                    color: m.role === 'user' ? '#90c4ff' : '#d0f0ff',
                    borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                    padding: '10px 14px',
                    fontSize: 15, lineHeight: 1.6,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    <div style={{ fontSize: 8, letterSpacing: 2, opacity: 0.5, marginBottom: 5 }}>
                      {m.role === 'user' ? '▶ SİZ' : '◀ JARVIS'}
                    </div>
                    {m.content}
                    {i === messages.length - 1 && streaming && m.role === 'assistant' && (
                      <span style={{ opacity: 0.5, marginLeft: 3, animationName: 'statusBlink', animationDuration: '0.8s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' }}>▋</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* HUD view */}
          {!showChat && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'flex-start',
              gap: 10, paddingTop: 44, paddingBottom: 8,
            }}>
              {/* Corner panels */}
              <div className="data-flicker" style={{
                position: 'absolute', top: 8, left: 12,
                fontSize: 8.5, color: 'rgba(var(--hud-rgb),0.42)',
                letterSpacing: 1.5, lineHeight: 2.1,
              }}>
                <div style={{ color: '#00d4ff', opacity: 0.6, fontSize: 7.5, marginBottom: 1 }}>┌── SYS</div>
                <div>CPU · <span style={{ color: '#00ff88' }}>12%</span></div>
                <div>MEM · <span style={{ color: '#ffd60a' }}>64%</span></div>
                <div>NET · LOCAL</div>
              </div>

              <div className="data-flicker" style={{
                position: 'absolute', top: 8, right: 12,
                fontSize: 8.5, color: 'rgba(var(--hud-rgb),0.42)',
                letterSpacing: 1.5, lineHeight: 2.1, textAlign: 'right',
              }}>
                <div style={{ color: '#00d4ff', opacity: 0.6, fontSize: 7.5, marginBottom: 1 }}>AI ──┐</div>
                <div>PROC · <span style={{ color: streaming ? '#ff9f0a' : '#00ff88' }}>{streaming ? 'BUSY' : 'IDLE'}</span></div>
                <div>TTS · <span style={{ color: ttsEnabled ? '#00ff88' : '#ff453a' }}>{ttsEnabled ? 'ON' : 'OFF'}</span></div>
                <div>MIC · <span style={{ color: micDenied ? '#ff453a' : voiceState !== 'idle' ? '#00ff88' : '#ffd60a' }}>{micDenied ? 'BLOCKED' : voiceState !== 'idle' ? 'ON' : 'WAIT'}</span></div>
              </div>

              {/* Mic denied warning */}
              {micDenied && (
                <div style={{
                  position: 'absolute', top: 70, left: 0, right: 0,
                  textAlign: 'center', fontSize: 10, letterSpacing: 2,
                  color: '#ff453a', padding: '4px 16px',
                  background: 'rgba(255,69,58,0.1)',
                  border: '1px solid rgba(255,69,58,0.3)',
                  margin: '0 20px', borderRadius: 4,
                }}>
                  MİKROFON İZNİ GEREKİYOR
                </div>
              )}

              {/* Image panel — above circle, shown when AI returns an image URL */}
              {imageUrl && (
                <div style={{
                  width: 'calc(100% - 28px)', maxWidth: 360,
                  borderRadius: 8,
                  border: '1px solid rgba(var(--hud-rgb),0.35)',
                  background: 'rgba(0,12,28,0.88)',
                  overflow: 'hidden',
                  flexShrink: 0,
                  position: 'relative',
                  animation: 'imgFadeIn 0.35s ease-out',
                  boxShadow: '0 0 24px rgba(var(--hud-rgb),0.12)',
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt="Jarvis görsel"
                    style={{
                      display: 'block', width: '100%',
                      maxHeight: 180, objectFit: 'cover',
                    }}
                    onError={() => setImageUrl(null)}
                  />
                  <button
                    className="hud-btn"
                    onClick={() => setImageUrl(null)}
                    style={{
                      position: 'absolute', top: 6, right: 6,
                      width: 22, height: 22, borderRadius: '50%',
                      border: '1px solid rgba(var(--hud-rgb),0.5)',
                      background: 'rgba(0,10,24,0.82)',
                      color: 'rgba(var(--hud-rgb),0.8)', fontSize: 10,
                      cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    ✕
                  </button>
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    height: 24,
                    background: 'linear-gradient(0deg, rgba(0,10,24,0.7) 0%, transparent 100%)',
                    pointerEvents: 'none',
                  }} />
                </div>
              )}

              {/* HUD circle — scaled to fit viewport */}
              <div style={{
                width: SZ * hudScale,
                height: SZ * hudScale,
                flexShrink: 0,
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute',
                  width: SZ,
                  height: SZ,
                  transform: `scale(${hudScale})`,
                  transformOrigin: 'top left',
                  animationName: 'hudGlow',
                  animationDuration: '4s',
                  animationTimingFunction: 'ease-in-out',
                  animationIterationCount: 'infinite',
                }}>
                  <HudSvg c={waveColor} />

                  {/* Rotating scan sweep */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    animationName: 'scanArc',
                    animationDuration: scanSpeed,
                    animationTimingFunction: 'linear',
                    animationIterationCount: 'infinite',
                    pointerEvents: 'none',
                  }}>
                    <svg width={SZ} height={SZ}>
                      <path
                        d="M150,150 L150,30 A120,120 0 0,1 210,46.1 Z"
                        fill={`rgba(${waveColor === '#00ff88' ? '0,255,136' : waveColor === '#ff9f0a' ? '255,159,10' : '0,212,255'},0.06)`}
                      />
                      <line x1="150" y1="150" x2="150" y2="30"
                        stroke={waveColor} strokeWidth="2" opacity="0.72" strokeLinecap="round" />
                    </svg>
                  </div>

                  {/* Waveform bars */}
                  <div style={{
                    position: 'absolute', top: '50%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    display: 'flex', alignItems: 'center',
                    gap: 3, height: 64, width: 120,
                    justifyContent: 'center', pointerEvents: 'none',
                  }}>
                    {Array.from({ length: N_BARS }, (_, i) => (
                      <div key={i} style={{
                        width: 3, height: 64,
                        background: waveColor,
                        borderRadius: 2,
                        boxShadow: `0 0 6px ${waveColor}`,
                        transformOrigin: 'center',
                        animationName: waveActive ? 'waveBar' : 'idleBar',
                        animationDuration: waveActive ? `${380 + (i % 6) * 75}ms` : '3.8s',
                        animationTimingFunction: 'ease-in-out',
                        animationIterationCount: 'infinite',
                        animationDirection: 'alternate',
                        animationDelay: `${Math.round(i * (700 / N_BARS))}ms`,
                      }} />
                    ))}
                  </div>

                  {/* Status label */}
                  <div style={{
                    position: 'absolute', bottom: 32, left: 0, right: 0,
                    textAlign: 'center', fontSize: 8.5, letterSpacing: 3.5,
                    color: waveColor, textShadow: `0 0 10px ${waveColor}`,
                    animationName: waveActive ? 'statusBlink' : 'none',
                    animationDuration: '1.4s',
                    animationIterationCount: 'infinite',
                    animationTimingFunction: 'ease-in-out',
                    pointerEvents: 'none',
                  }}>
                    {statusText}
                  </div>

                  {/* Wake word hint */}
                  {(voiceState === 'wake' || voiceState === 'idle') && connected && !micDenied && (
                    <div style={{
                      position: 'absolute', bottom: 18, left: 0, right: 0,
                      textAlign: 'center', fontSize: 7, letterSpacing: 2,
                      color: 'rgba(var(--hud-rgb),0.3)', pointerEvents: 'none',
                    }}>
                      "HEY JARVIS" diyerek başlat
                    </div>
                  )}
                </div>
              </div>

              {/* Response box — shows last 4 messages + pending speech + interim */}
              {hasContent && (
                <div style={{
                  width: 'calc(100% - 20px)', maxWidth: 420,
                  background: 'linear-gradient(180deg, rgba(0,10,26,0.92) 0%, rgba(0,6,18,0.96) 100%)',
                  border: '1px solid rgba(var(--hud-rgb),0.28)',
                  borderRadius: 10,
                  flexShrink: 0,
                  overflow: 'hidden',
                  boxShadow: '0 0 32px rgba(var(--hud-rgb),0.08), inset 0 1px 0 rgba(var(--hud-rgb),0.12)',
                }}>
                  {/* Top bar */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 12px 4px',
                    borderBottom: '1px solid rgba(var(--hud-rgb),0.1)',
                  }}>
                    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: waveColor, boxShadow: `0 0 6px ${waveColor}` }} />
                      <span style={{ fontSize: 7.5, letterSpacing: 2.5, color: 'rgba(var(--hud-rgb),0.55)' }}>KANAL</span>
                    </div>
                    {speechBuf && (
                      <span style={{ fontSize: 7, letterSpacing: 1.5, color: 'rgba(255,159,10,0.7)', animationName: 'statusBlink', animationDuration: '1.2s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' }}>
                        ● KAYIT
                      </span>
                    )}
                  </div>

                  {/* Messages scroll area */}
                  <div ref={msgBoxRef} className="msg-box-scroll" style={{ maxHeight: 220, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {recentMsgs.map((m, i) => (
                      <div key={i}>
                        <div style={{ fontSize: 7.5, letterSpacing: 2, color: m.role === 'user' ? 'rgba(100,180,255,0.5)' : 'rgba(var(--hud-rgb),0.45)', marginBottom: 3 }}>
                          {m.role === 'user' ? '▶ SİZ' : '◀ JARVIS'}
                        </div>
                        <div style={{
                          fontSize: 14, lineHeight: 1.6,
                          color: m.role === 'user' ? 'rgba(150,200,255,0.9)' : 'rgba(210,245,255,0.92)',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {m.content}
                          {i === recentMsgs.length - 1 && streaming && m.role === 'assistant' && (
                            <span style={{ opacity: 0.5, marginLeft: 2, animationName: 'statusBlink', animationDuration: '0.8s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' }}>▋</span>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Accumulated pending speech */}
                    {speechBuf && (
                      <div>
                        <div style={{ fontSize: 7.5, letterSpacing: 2, color: 'rgba(255,159,10,0.55)', marginBottom: 3 }}>▶ SİZ (beklemede)</div>
                        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,200,120,0.88)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {speechBuf}
                        </div>
                      </div>
                    )}

                    {/* Live interim text */}
                    {interimText && (
                      <div style={{ fontSize: 13, color: 'rgba(var(--hud-rgb),0.35)', fontStyle: 'italic', lineHeight: 1.5 }}>
                        {interimText}…
                      </div>
                    )}
                  </div>

                  {/* Okey hint footer */}
                  {speechBuf && (
                    <div style={{
                      padding: '5px 12px',
                      borderTop: '1px solid rgba(var(--hud-rgb),0.08)',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{ fontSize: 7, letterSpacing: 1.5, color: 'rgba(255,159,10,0.55)' }}>
                        "OKEY" diyerek gönder · "DUR JARVIS" iptal eder
                      </span>
                    </div>
                  )}
                  {voiceState === 'speaking' && (
                    <div style={{
                      padding: '5px 12px',
                      borderTop: '1px solid rgba(var(--hud-rgb),0.08)',
                    }}>
                      <span style={{ fontSize: 7, letterSpacing: 1.5, color: 'rgba(255,159,10,0.55)' }}>
                        "DUR JARVIS" diyerek durdur
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input row */}
        <div style={{
          padding: '7px 10px',
          background: 'rgba(0,10,22,0.92)',
          borderTop: '1px solid rgba(var(--hud-rgb),0.18)',
          display: 'flex', gap: 7, flexShrink: 0, alignItems: 'center',
        }}>
          <button className="hud-btn" onClick={toggleVoice}
            disabled={streaming || !connected || !voiceSupported || micDenied}
            title={micDenied ? 'Mikrofon izni gerekiyor' : 'Sesli komut'}
            style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              border: `2px solid ${voiceState === 'listening' ? '#00ff88' : voiceState === 'wake' ? 'rgba(var(--hud-rgb),0.6)' : 'rgba(var(--hud-rgb),0.3)'}`,
              background: voiceState === 'listening' ? 'rgba(0,255,136,0.14)' : voiceState === 'wake' ? 'rgba(var(--hud-rgb),0.07)' : 'rgba(0,18,38,0.8)',
              color: voiceState === 'listening' ? '#00ff88' : '#00d4ff',
              fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: voiceState === 'listening' ? '0 0 18px rgba(0,255,136,0.55)' : '0 0 8px rgba(var(--hud-rgb),0.15)',
              transition: 'all 0.2s',
              animationName: voiceState === 'listening' ? 'onlineDot' : 'none',
              animationDuration: '1.2s',
              animationIterationCount: 'infinite',
            }}>
            {micDenied ? '🚫' : '🎤'}
          </button>

          <input className="hud-input" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={voiceState === 'listening' ? 'Dinleniyor…' : voiceState === 'wake' ? '"Hey Jarvis" veya yaz…' : 'Komut gir…'}
            disabled={!connected || streaming}
            style={{
              flex: 1, background: 'rgba(0,12,28,0.7)',
              border: '1px solid rgba(var(--hud-rgb),0.3)', borderRadius: 5,
              padding: '10px 13px', color: '#c8f0ff', fontSize: 14,
              fontFamily: '"Courier New", monospace', letterSpacing: 0.4,
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }} />

          <button className="hud-btn" onClick={() => setVolume(v => Math.max(0, parseFloat((v - 0.2).toFixed(1))))}
            style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              border: '1.5px solid rgba(var(--hud-rgb),0.38)',
              background: 'rgba(0,15,32,0.7)',
              color: 'rgba(var(--hud-rgb),0.7)', fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}>
            🔉
          </button>

          <button className="hud-btn" onClick={() => setVolume(v => Math.min(1, parseFloat((v + 0.2).toFixed(1))))}
            style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              border: '1.5px solid rgba(var(--hud-rgb),0.38)',
              background: 'rgba(0,15,32,0.7)',
              color: 'rgba(var(--hud-rgb),0.7)', fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}>
            🔊
          </button>

          <button
            className="hud-btn"
            onPointerDown={(e) => { e.preventDefault(); pttDown(); }}
            onPointerUp={(e) => { e.preventDefault(); pttUp(); }}
            onPointerCancel={() => pttUp()}
            onPointerLeave={() => { if (voiceState === 'listening') pttUp(); }}
            disabled={!connected || !voiceSupported || micDenied}
            title="Konuşmak için basılı tut"
            style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              border: `2px solid ${voiceState === 'listening' ? '#00ff88' : 'rgba(var(--hud-rgb),0.5)'}`,
              background: voiceState === 'listening' ? 'rgba(0,255,136,0.2)' : 'rgba(0,40,80,0.5)',
              color: voiceState === 'listening' ? '#00ff88' : '#00d4ff',
              fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: voiceState === 'listening' ? '0 0 18px rgba(0,255,136,0.55)' : '0 0 6px rgba(var(--hud-rgb),0.18)',
              transition: 'all 0.15s',
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            🎙
          </button>

          <button className="hud-btn" onClick={send}
            disabled={!input.trim() || !connected || streaming}
            style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              border: `2px solid ${input.trim() && connected ? '#00d4ff' : 'rgba(var(--hud-rgb),0.2)'}`,
              background: input.trim() && connected ? 'rgba(0,120,220,0.2)' : 'rgba(0,12,28,0.6)',
              color: input.trim() && connected ? '#00d4ff' : 'rgba(var(--hud-rgb),0.25)',
              fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: input.trim() && connected ? '0 0 14px rgba(var(--hud-rgb),0.35)' : 'none',
              transition: 'all 0.2s',
            }}>
            ↑
          </button>
        </div>

        {/* Volume bar */}
        <div style={{
          height: 22, background: 'rgba(0,8,18,0.88)',
          display: 'flex', alignItems: 'center',
          padding: '0 14px', gap: 8, flexShrink: 0,
        }}>
          <span style={{ fontSize: 7.5, letterSpacing: 2, color: 'rgba(var(--hud-rgb),0.4)' }}>VOL</span>
          <div style={{ flex: 1, height: 3, background: 'rgba(var(--hud-rgb),0.1)', borderRadius: 2 }}>
            <div style={{
              height: '100%', width: `${volPct}%`,
              background: `linear-gradient(90deg, #00d4ff, ${waveColor})`,
              borderRadius: 2, boxShadow: `0 0 6px ${waveColor}`,
              transition: 'width 0.2s, box-shadow 0.2s',
            }} />
          </div>
          <span style={{ fontSize: 7.5, letterSpacing: 1, color: 'rgba(var(--hud-rgb),0.5)', minWidth: 24 }}>{volPct}%</span>
        </div>

        {/* Bottom HUD buttons */}
        <div style={{
          display: 'flex', justifyContent: 'space-around', alignItems: 'center',
          padding: '6px 10px',
          paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
          background: 'rgba(0,5,14,0.95)',
          borderTop: '1px solid rgba(var(--hud-rgb),0.14)',
          flexShrink: 0,
        }}>
          {bottomBtns.map((btn) => (
            <button key={btn.label} className="hud-btn" onClick={btn.action} title={btn.title} style={{
              minWidth: 60, height: 38,
              borderRadius: 4,
              border: `1.5px solid rgba(var(--hud-rgb),${btn.active ? '0.7' : '0.3'})`,
              background: btn.active ? 'rgba(var(--hud-rgb),0.12)' : 'rgba(0,15,32,0.55)',
              color: `rgba(var(--hud-rgb),${btn.active ? '1' : '0.6'})`,
              fontSize: 10, letterSpacing: 1.5,
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 2,
              boxShadow: btn.active ? '0 0 10px rgba(var(--hud-rgb),0.2)' : 'none',
              transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>{btn.icon}</span>
              <span style={{ fontSize: 7, letterSpacing: 2 }}>{btn.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
