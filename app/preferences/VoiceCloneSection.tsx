'use client';

import { useRef, useState } from 'react';

import { BACKEND } from '@/lib/backend';

export function VoiceCloneSection() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [audioPath, setAudioPath] = useState('');
  const [setActive, setSetActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; voice_id?: string; error?: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const recordSample = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        // Upload to backend tmp via /api/voice/upload-sample
        const fd = new FormData();
        fd.append('file', blob, `sample-${Date.now()}.webm`);
        try {
          const r = await fetch(`${BACKEND}/api/voice/upload-sample`, { method: 'POST', body: fd });
          const j = await r.json();
          if (j.path) setAudioPath(j.path);
        } catch { /* fallback: ask user to provide path manually */ }
        setRecording(false);
      };
      recorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {
      alert('Mikrofon erişimi reddedildi: ' + (e as Error).message);
    }
  };

  const submit = async () => {
    if (!name.trim() || !audioPath.trim()) {
      alert('İsim ve audio_path gerekli (kaydet veya yol gir)');
      return;
    }
    setBusy(true); setResult(null);
    try {
      const r = await fetch(`${BACKEND}/api/voice/eleven/clone`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, audio_path: audioPath, set_active: setActive }),
      });
      setResult(await r.json());
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '0.75rem', opacity: 0.7, lineHeight: 1.5 }}>
        ElevenLabs voice clone — kendi sesini eğit. 30-90 saniyelik temiz bir kayıt yeterli.
        Kayıt sonrası backend tmp dosyasına yüklenir, ElevenLabs API&apos;ye gönderilir, voice_id döner.
        <strong> Set active</strong> açıksa <code>ELEVENLABS_VOICE_ID</code> otomatik güncellenir.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Voice ismi (örn: Patron)"
          style={inputStyle}
        />
        <input
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Açıklama (opsiyonel)"
          style={inputStyle}
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={audioPath} onChange={(e) => setAudioPath(e.target.value)}
          placeholder="Audio path (mp3/wav/webm — kaydetmek istemiyorsan yol gir)"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={recordSample}
          style={{
            padding: '8px 14px', fontSize: 11, letterSpacing: '0.14em',
            background: recording ? 'rgba(255,80,120,0.18)' : 'rgba(0,212,255,0.15)',
            border: `1px solid ${recording ? '#ff6688' : 'var(--hud-cyan)'}`,
            color: recording ? '#ff6688' : 'var(--hud-cyan)', borderRadius: 4, cursor: 'pointer',
            fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
          }}
        >{recording ? '⏹ DURDUR' : '🎤 KAYDET'}</button>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={setActive} onChange={(e) => setSetActive(e.target.checked)} />
        Klonladıktan sonra aktif voice yap
      </label>

      <button
        onClick={submit} disabled={busy || !name.trim() || !audioPath.trim()}
        style={{
          padding: '10px 16px', fontSize: 12, letterSpacing: '0.16em',
          background: 'rgba(178,102,255,0.18)', border: '1px solid #b266ff',
          color: '#b266ff', borderRadius: 4,
          cursor: busy ? 'wait' : 'pointer',
          fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
        }}
      >{busy ? 'KLONLANIYOR…' : '✦ VOICE CLONE'}</button>

      {result && (
        <div style={{
          padding: 10, borderRadius: 4,
          background: result.ok ? 'rgba(52,211,153,0.08)' : 'rgba(255,80,80,0.08)',
          border: `1px solid ${result.ok ? 'rgba(52,211,153,0.4)' : 'rgba(255,80,80,0.4)'}`,
          color: result.ok ? '#34d399' : '#ff8888',
          fontSize: 11, fontFamily: 'monospace',
        }}>
          {result.ok ? `✓ Voice ID: ${result.voice_id}` : `✗ ${result.error}`}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: 12,
  background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
  color: 'var(--text-primary)', borderRadius: 4, fontFamily: 'inherit',
};
