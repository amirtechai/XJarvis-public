'use client';

import { useEffect, useRef, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface Segment {
  text: string;
  ts: number;
}

interface AgentReply {
  text: string;
  ts: number;
}

/**
 * Long-form dictation using the browser's MediaRecorder + Deepgram API directly.
 * Streams 16kHz PCM via WebSocket; renders interim + final transcripts; allows
 * pause/resume, copy, save to file, and clear.
 */
export function DictationClient() {
  const [running, setRunning] = useState(false);
  const [interim, setInterim] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [keyMissing, setKeyMissing] = useState<boolean | null>(null);
  const [language, setLanguage] = useState('tr');
  const [forwardToAgent, setForwardToAgent] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentReply, setAgentReply] = useState<AgentReply | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);

  // Probe whether DEEPGRAM_API_KEY is configured on the backend
  useEffect(() => {
    fetch(`${BACKEND}/api/setup/status`)
      .then((r) => r.json())
      .then((d) => setKeyMissing(d.keys?.DEEPGRAM_API_KEY?.present !== true))
      .catch(() => setKeyMissing(true));
  }, []);

  const fetchKey = async (): Promise<string | null> => {
    try {
      const r = await fetch(`${BACKEND}/api/setup/dictation-token`);
      if (!r.ok) return null;
      const data = await r.json();
      return data.key || null;
    } catch {
      return null;
    }
  };

  const start = async () => {
    setError(null);
    const key = await fetchKey();
    if (!key) {
      setError('DEEPGRAM_API_KEY eksik — Preferences → API Keys');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
    } catch (e) {
      setError(`Mikrofon izni reddedildi: ${e}`);
      return;
    }
    streamRef.current = stream;
    const ctx = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)({ sampleRate: 16000 });
    audioCtxRef.current = ctx;

    const params = new URLSearchParams({
      model: 'nova-3',
      language,
      smart_format: 'true',
      punctuate: 'true',
      interim_results: 'true',
      endpointing: '500',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', key]);
    wsRef.current = ws;

    ws.onopen = () => {
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = processor;
      processor.onaudioprocess = (ev) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = ev.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(pcm.buffer);
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      setRunning(true);
    };

    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string);
        if (m.type !== 'Results') return;
        const alt = m.channel?.alternatives?.[0];
        if (!alt) return;
        const text = (alt.transcript || '').trim();
        if (!text) return;
        if (m.is_final) {
          setSegments((prev) => [...prev, { text, ts: Date.now() }]);
          setInterim('');
        } else {
          setInterim(text);
        }
      } catch { /* ignore */ }
    };

    ws.onerror = () => setError('Deepgram bağlantı hatası');
    ws.onclose = () => stop();
  };

  const stop = (auto = false) => {
    setRunning(false);
    setInterim('');
    procRef.current?.disconnect();
    procRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    if (wsRef.current && wsRef.current.readyState <= 1) {
      try { wsRef.current.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* ignore */ }
      wsRef.current.close();
    }
    wsRef.current = null;
    if (forwardToAgent && !auto) {
      // Manual stop with toggle on → fire-and-stream after a short flush window
      setTimeout(() => sendToAgent(), 400);
    }
  };

  const sendToAgent = async () => {
    const text = segments.map((s) => s.text).join(' ').trim();
    if (!text) return;
    setAgentBusy(true);
    setAgentReply(null);
    try {
      const res = await fetch('http://127.0.0.1:8767/agent/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
      });
      if (!res.ok || !res.body) {
        setAgentReply({ text: `[hata: agent ${res.status}]`, ts: Date.now() });
        return;
      }
      // Parse SSE stream for text events
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assembled = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'text' && typeof ev.content === 'string') {
              assembled += ev.content;
              setAgentReply({ text: assembled, ts: Date.now() });
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      setAgentReply({ text: `[hata: ${e}]`, ts: Date.now() });
    } finally {
      setAgentBusy(false);
    }
  };

  useEffect(() => {
    return () => { stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fullText = segments.map((s) => s.text).join('\n\n');

  const copy = () => navigator.clipboard.writeText(fullText);
  const download = () => {
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dictation-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const clear = () => { setSegments([]); setInterim(''); };

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '2rem',
        background: 'radial-gradient(circle at 50% 0%, #0a1424 0%, #050a14 70%)',
        color: 'var(--hud-cyan, #00d4ff)',
        fontFamily: 'var(--font-orbitron, monospace)',
      }}
    >
      <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <header>
          <div style={{ fontSize: '1.2rem', letterSpacing: '0.3em' }}>DICTATION</div>
          <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: 4 }}>
            Uzun-form ses → metin (Deepgram Nova-3 streaming, tarayıcı doğrudan WS).
          </div>
        </header>

        {keyMissing && (
          <div style={errorBox}>
            DEEPGRAM_API_KEY eksik. <a href="/preferences" style={{ color: '#00d4ff' }}>Preferences → API Keys</a>'tan ekle.
          </div>
        )}
        {error && <div style={errorBox}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!running ? (
            <button onClick={start} disabled={keyMissing === true} style={primaryBtn}>● Başlat</button>
          ) : (
            <button onClick={() => stop(false)} style={dangerBtn}>■ Durdur</button>
          )}
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={running}
            style={selectStyle}
          >
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
            <option value="multi">Multilingual</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={forwardToAgent}
              onChange={(e) => setForwardToAgent(e.target.checked)}
              style={{ accentColor: '#00d4ff' }}
            />
            Durunca XJarvis'e gönder
          </label>
          <span style={{ flex: 1 }} />
          {forwardToAgent && (
            <button
              onClick={sendToAgent}
              disabled={!fullText || agentBusy || running}
              style={primaryBtn}
            >
              {agentBusy ? '…' : '→ XJarvis'}
            </button>
          )}
          <button onClick={copy} disabled={!fullText} style={ghostBtn}>Kopyala</button>
          <button onClick={download} disabled={!fullText} style={ghostBtn}>İndir (.txt)</button>
          <button onClick={clear} disabled={!fullText} style={ghostBtn}>Temizle</button>
        </div>

        <div
          style={{
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(var(--hud-rgb),0.2)',
            borderRadius: 10,
            padding: '1.2rem',
            minHeight: 300,
            fontFamily: 'system-ui, sans-serif',
            fontSize: '0.95rem',
            lineHeight: 1.6,
            color: '#e4e4e7',
            whiteSpace: 'pre-wrap',
            overflowY: 'auto',
            maxHeight: '60vh',
          }}
        >
          {segments.map((s, i) => (
            <p key={i} style={{ margin: '0 0 1rem 0' }}>{s.text}</p>
          ))}
          {interim && (
            <span style={{ color: '#71717a', fontStyle: 'italic' }}>{interim}</span>
          )}
          {!fullText && !interim && (
            <span style={{ opacity: 0.4 }}>
              {running ? 'Dinleniyor… konuşmaya başla.' : 'Başlat\'a tıkla, mikrofona konuş.'}
            </span>
          )}
        </div>

        {agentReply && (
          <div
            style={{
              background: 'rgba(var(--hud-rgb),0.05)',
              border: '1px solid rgba(var(--hud-rgb),0.3)',
              borderRadius: 10,
              padding: '1rem 1.2rem',
            }}
          >
            <div style={{ fontSize: '0.7rem', letterSpacing: '0.18em', opacity: 0.7, marginBottom: 8 }}>
              XJARVIS YANITI {agentBusy && '· yazıyor…'}
            </div>
            <div style={{ fontSize: '0.9rem', color: '#e4e4e7', whiteSpace: 'pre-wrap', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
              {agentReply.text}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, fontSize: '0.7rem', opacity: 0.6 }}>
          <span>Segment: {segments.length}</span>
          <span>Karakter: {fullText.length}</span>
          <span>Kelime: {fullText.split(/\s+/).filter(Boolean).length}</span>
        </div>
      </div>
    </main>
  );
}

const primaryBtn: React.CSSProperties = {
  background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
  color: '#001a26',
  border: 'none',
  padding: '0.6rem 1.4rem',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.9rem',
};
const dangerBtn: React.CSSProperties = {
  background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
  color: '#fff',
  border: 'none',
  padding: '0.6rem 1.4rem',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.9rem',
};
const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--hud-cyan, #00d4ff)',
  border: '1px solid rgba(var(--hud-rgb),0.4)',
  padding: '0.5rem 1rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.8rem',
};
const selectStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(var(--hud-rgb),0.3)',
  color: '#fff',
  padding: '0.5rem 0.85rem',
  borderRadius: 6,
  fontSize: '0.85rem',
};
const errorBox: React.CSSProperties = {
  padding: '0.85rem 1rem',
  borderRadius: 8,
  background: 'rgba(239,68,68,0.08)',
  border: '1px solid rgba(239,68,68,0.4)',
  color: '#fca5a5',
  fontSize: '0.85rem',
};
