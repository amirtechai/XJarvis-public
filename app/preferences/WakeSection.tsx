'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface BuiltinModel { id: string; label: string; recommended: boolean }
interface WakeState {
  engine: string;
  model: string;
  threshold: number;
  framework: 'onnx' | 'tflite';
  enabled: boolean;
  builtin_models: BuiltinModel[];
}

export function WakeSection() {
  const [state, setState] = useState<WakeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    fetch(`${BACKEND}/api/wake/state`)
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});

  useEffect(() => { load(); }, []);

  const save = async (patch: Partial<WakeState>) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${BACKEND}/api/wake/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((x) => x.json());
      if (r.ok) {
        setState(r.state);
        setMsg('Kaydedildi. Voice servisini yeniden başlat: launchctl kickstart -k gui/$(id -u)/com.jarvis.voice');
      } else {
        setMsg(r.error || 'kayıt başarısız');
      }
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  const test = async () => {
    const r = await fetch(`${BACKEND}/api/wake/test`, { method: 'POST' }).then((x) => x.json()).catch(() => ({ ok: false }));
    setMsg(r.ok ? 'Test tetiklendi — XJarvis dinlemeye geçti' : 'Voice servisi yanıt vermedi');
  };

  if (!state) return <div style={{ opacity: 0.5, fontSize: 12 }}>Yükleniyor…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        XJarvis <strong>openWakeWord</strong> motoru kullanıyor — açık kaynak, ücretsiz, API key gerektirmez.
        Hazır modeller arasından birini seç. Custom model için <code>WAKE_MODEL</code>'a .onnx veya .tflite
        dosya yolu gir (.env'den).
      </div>

      <div style={{ border: '1px solid rgba(var(--hud-rgb),0.2)', borderRadius: 6, padding: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Wake Word Modeli</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {state.builtin_models.map((m) => {
            const active = state.model === m.id;
            return (
              <button
                key={m.id}
                onClick={() => save({ model: m.id })}
                disabled={busy || active}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px',
                  background: active ? 'rgba(var(--hud-rgb),0.12)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(var(--hud-rgb),0.5)' : 'rgba(var(--hud-rgb),0.18)'}`,
                  color: active ? 'var(--hud-cyan)' : 'var(--text-primary)',
                  borderRadius: 4, cursor: active ? 'default' : 'pointer',
                  fontSize: 12, fontFamily: 'inherit',
                }}
              >
                <span>
                  {active && '✓ '}{m.label}
                  {m.recommended && <span style={{ marginLeft: 8, fontSize: 9, color: '#34d399', letterSpacing: '0.1em' }}>ÖNERİLEN</span>}
                </span>
                <span style={{ fontSize: 10, opacity: 0.5, fontFamily: 'monospace' }}>{m.id}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ border: '1px solid rgba(var(--hud-rgb),0.2)', borderRadius: 6, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
          <span style={{ opacity: 0.7 }}>Hassasiyet (threshold)</span>
          <span style={{ color: 'var(--hud-cyan)', fontFamily: 'monospace' }}>{state.threshold.toFixed(2)}</span>
        </div>
        <input
          type="range" min={0.1} max={0.9} step={0.05}
          value={state.threshold}
          onChange={(e) => setState({ ...state, threshold: parseFloat(e.target.value) })}
          onMouseUp={() => save({ threshold: state.threshold })}
          style={{ width: '100%', accentColor: 'var(--hud-cyan)' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, opacity: 0.5, marginTop: 4 }}>
          <span>Daha rahat tetiklenir</span>
          <span>Daha az hatalı tetik</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={() => save({ enabled: !state.enabled })}
          style={{
            padding: '6px 14px', borderRadius: 4,
            background: state.enabled ? 'rgba(var(--hud-rgb),0.18)' : 'transparent',
            border: '1px solid rgba(var(--hud-rgb),0.5)',
            color: 'var(--hud-cyan)', fontSize: 11, cursor: 'pointer',
          }}
        >{state.enabled ? '● Açık' : '○ Kapalı'}</button>
        <button
          onClick={test}
          style={{
            padding: '6px 14px', borderRadius: 4,
            background: 'transparent', border: '1px solid rgba(var(--hud-rgb),0.3)',
            color: 'var(--hud-cyan)', fontSize: 11, cursor: 'pointer',
          }}
        >Test tetikle</button>
      </div>

      {msg && (
        <div style={{
          padding: '8px 12px', borderRadius: 4,
          background: 'rgba(var(--hud-rgb),0.08)', border: '1px solid rgba(var(--hud-rgb),0.3)',
          color: 'var(--hud-cyan)', fontSize: 11, fontFamily: 'monospace',
        }}>{msg}</div>
      )}
    </div>
  );
}
