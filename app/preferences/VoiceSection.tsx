'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface Voice { name: string; locale: string; sample: string }
interface ElevenVoice { id: string; name: string; description: string; gender: string; accent: string; age: string }
interface State {
  backend: 'native' | 'elevenlabs';
  voice: string;
  rate: number;
  openai_enabled: boolean;
  openai_voice: string;
  openai_voices: string[];
  eleven_enabled: boolean;
  eleven_voice_id: string;
  eleven_model: string;
}

export function VoiceSection() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [elevenVoices, setElevenVoices] = useState<ElevenVoice[] | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [filter, setFilter] = useState<'tr' | 'en' | 'all'>('tr');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/voice/list`).then((r) => r.json()).then((d) => setVoices(d.voices || [])).catch(() => {});
    fetch(`${BACKEND}/api/voice/state`).then((r) => r.json()).then((s) => {
      setState(s);
      if (s.eleven_enabled) {
        fetch(`${BACKEND}/api/voice/eleven/list`).then((r) => r.json()).then((d) => {
          if (d.ok) setElevenVoices(d.voices || []);
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const filtered = voices.filter((v) =>
    filter === 'all' ? true :
    filter === 'tr' ? v.locale === 'tr_TR' :
    v.locale.startsWith('en'),
  );

  const save = async (patch: Partial<State>) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${BACKEND}/api/voice/set`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((x) => x.json());
      if (r.ok) {
        setState({ ...(state as State), ...r.state });
        setMsg('Kaydedildi. Voice servisini yeniden başlat: launchctl kickstart -k gui/$(id -u)/com.jarvis.voice');
      } else {
        setMsg(r.error || 'kayıt başarısız');
      }
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  const preview = async (voice: string) => {
    await fetch(`${BACKEND}/api/voice/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice, rate: state?.rate, text: 'Merhaba, ben XJarvis. Sesimi seçtiğin için teşekkür ederim.' }),
    }).catch(() => {});
  };

  const previewEleven = async (voiceId: string) => {
    await fetch(`${BACKEND}/api/voice/eleven/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_id: voiceId, text: 'Merhaba efendim. Ben XJarvis. Sesimi nasıl buldunuz?' }),
    }).catch(() => {});
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        XJarvis'in TTS sesini buradan seç. ElevenLabs (anahtar varsa) en doğal seçenek — ayda 10K karakter
        ücretsiz. macOS yerleşik sesleri her zaman çalışır ama daha robotik.
      </div>

      {/* Backend seçici */}
      <div style={{ border: '1px solid rgba(var(--hud-rgb),0.2)', borderRadius: 6, padding: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>TTS Motoru</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {([
            { id: 'native' as const, label: 'macOS Yerleşik', avail: true },
            { id: 'elevenlabs' as const, label: 'ElevenLabs', avail: state?.eleven_enabled },
          ]).map((b) => {
            const active = state?.backend === b.id;
            return (
              <button
                key={b.id}
                onClick={() => save({ backend: b.id })}
                disabled={busy || !b.avail || active}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 4,
                  background: active ? 'rgba(var(--hud-rgb),0.18)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(var(--hud-rgb),0.6)' : 'rgba(var(--hud-rgb),0.25)'}`,
                  color: b.avail ? 'var(--hud-cyan)' : '#52525b',
                  fontSize: 12, cursor: !b.avail || active ? 'default' : 'pointer',
                  opacity: !b.avail ? 0.4 : 1,
                }}
              >{active && '✓ '}{b.label}{!b.avail && ' (anahtar yok)'}</button>
            );
          })}
        </div>
      </div>

      {/* ElevenLabs voices */}
      {state?.eleven_enabled && (
        <div style={{ border: '1px solid rgba(var(--hud-rgb),0.2)', borderRadius: 6, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>ElevenLabs Sesleri</div>
            <span style={{ fontSize: 9, color: '#34d399', letterSpacing: '0.1em' }}>FREE TIER · 10K char/ay</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
            {!elevenVoices && <div style={{ opacity: 0.5, fontSize: 12 }}>Yükleniyor…</div>}
            {elevenVoices?.map((v) => {
              const active = state.eleven_voice_id === v.id;
              return (
                <div
                  key={v.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: active ? 'rgba(var(--hud-rgb),0.12)' : 'transparent',
                    border: `1px solid ${active ? 'rgba(var(--hud-rgb),0.5)' : 'transparent'}`,
                    borderRadius: 4,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: active ? 'var(--hud-cyan)' : 'var(--text-primary)' }}>
                      {v.name}
                    </span>
                    <span style={{ fontSize: 10, opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.gender} · {v.accent} · {v.age} {v.description && `· ${v.description}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => previewEleven(v.id)}
                      style={{
                        background: 'transparent', border: '1px solid rgba(var(--hud-rgb),0.3)',
                        color: 'var(--hud-cyan)', fontSize: 10, padding: '3px 10px',
                        borderRadius: 3, cursor: 'pointer',
                      }}
                    >▶ önizle</button>
                    <button
                      onClick={() => save({ eleven_voice_id: v.id } as Partial<State>)}
                      disabled={busy || active}
                      style={{
                        background: active ? 'transparent' : 'rgba(var(--hud-rgb),0.18)',
                        border: '1px solid rgba(var(--hud-rgb),0.5)',
                        color: 'var(--hud-cyan)', fontSize: 10, padding: '3px 10px',
                        borderRadius: 3, cursor: active ? 'default' : 'pointer',
                        opacity: active ? 0.5 : 1,
                      }}
                    >{active ? '✓ aktif' : 'seç'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* macOS yerleşik sesler */}
      <div style={{ border: '1px solid rgba(var(--hud-rgb),0.2)', borderRadius: 6, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>macOS Sesleri</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['tr', 'en', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? 'rgba(var(--hud-rgb),0.18)' : 'transparent',
                  border: '1px solid rgba(var(--hud-rgb),0.3)',
                  color: 'var(--hud-cyan)',
                  fontSize: 10, padding: '3px 10px', borderRadius: 3,
                  cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em',
                }}
              >
                {f === 'tr' ? 'Türkçe' : f === 'en' ? 'İngilizce' : 'Hepsi'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
          {filtered.length === 0 && <div style={{ opacity: 0.5, fontSize: 12 }}>Bu filtre için ses yok</div>}
          {filtered.map((v) => {
            const active = state?.voice === v.name;
            return (
              <div
                key={v.name}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: active ? 'rgba(var(--hud-rgb),0.12)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(var(--hud-rgb),0.5)' : 'transparent'}`,
                  borderRadius: 4,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 12, color: active ? 'var(--hud-cyan)' : 'var(--text-primary)' }}>
                    {v.name}
                  </span>
                  <span style={{ fontSize: 10, opacity: 0.5 }}>{v.locale}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => preview(v.name)}
                    style={{
                      background: 'transparent', border: '1px solid rgba(var(--hud-rgb),0.3)',
                      color: 'var(--hud-cyan)', fontSize: 10, padding: '3px 10px',
                      borderRadius: 3, cursor: 'pointer',
                    }}
                  >▶ önizle</button>
                  <button
                    onClick={() => save({ voice: v.name })}
                    disabled={busy || active}
                    style={{
                      background: active ? 'transparent' : 'rgba(var(--hud-rgb),0.18)',
                      border: '1px solid rgba(var(--hud-rgb),0.5)',
                      color: 'var(--hud-cyan)', fontSize: 10, padding: '3px 10px',
                      borderRadius: 3, cursor: active ? 'default' : 'pointer',
                      opacity: active ? 0.5 : 1,
                    }}
                  >{active ? '✓ aktif' : 'seç'}</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Hız (rate) */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(var(--hud-rgb),0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
            <span style={{ opacity: 0.7 }}>Konuşma hızı (kelime/dk)</span>
            <span style={{ color: 'var(--hud-cyan)', fontFamily: 'monospace' }}>{state?.rate ?? 190}</span>
          </div>
          <input
            type="range" min={120} max={280} step={10}
            value={state?.rate ?? 190}
            onChange={(e) => setState({ ...(state as State), rate: Number(e.target.value) })}
            onMouseUp={() => state && save({ rate: state.rate } as Partial<State>)}
            style={{ width: '100%', accentColor: 'var(--hud-cyan)' }}
          />
        </div>
      </div>

      {/* OpenAI TTS (opsiyonel) */}
      <div style={{ border: '1px solid rgba(var(--hud-rgb),0.2)', borderRadius: 6, padding: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          OpenAI TTS {state?.openai_enabled ? <span style={{ color: '#34d399', fontSize: 10 }}>● aktif</span> : <span style={{ color: '#71717a', fontSize: 10 }}>○ OPENAI_API_KEY yok</span>}
        </div>
        {state?.openai_enabled ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {state.openai_voices.map((v) => {
              const active = state.openai_voice === v;
              return (
                <button
                  key={v}
                  onClick={() => save({ openai_voice: v } as Partial<State>)}
                  style={{
                    background: active ? 'rgba(var(--hud-rgb),0.18)' : 'transparent',
                    border: '1px solid rgba(var(--hud-rgb),0.5)',
                    color: 'var(--hud-cyan)', fontSize: 11, padding: '4px 12px',
                    borderRadius: 3, cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {active && '✓ '}{v}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 11, opacity: 0.6 }}>
            OpenAI sesini etkinleştirmek için <code>OPENAI_API_KEY</code> ekle ve voice servisini yeniden başlat.
          </div>
        )}
      </div>

      {msg && (
        <div style={{
          padding: '8px 12px', borderRadius: 4,
          background: 'rgba(var(--hud-rgb),0.08)',
          border: '1px solid rgba(var(--hud-rgb),0.3)',
          color: 'var(--hud-cyan)', fontSize: 11,
          fontFamily: 'monospace',
        }}>{msg}</div>
      )}
    </div>
  );
}
