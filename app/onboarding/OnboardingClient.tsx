'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface KeyState {
  present: boolean;
  masked: string;
}
interface SetupStatus {
  keys: Record<string, KeyState>;
  services: { agent: boolean; voice: boolean; vision: boolean };
  setup_complete: boolean;
  voice_ready: boolean;
}

type Step = 'welcome' | 'openrouter' | 'deepgram' | 'optional' | 'mcp' | 'mic' | 'done';

const STEP_ORDER: Step[] = ['welcome', 'openrouter', 'deepgram', 'optional', 'mcp', 'mic', 'done'];

export function OnboardingClient() {
  const [step, setStep] = useState<Step>('welcome');
  const [status, setStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/setup/status`)
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  const advance = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) setStep(STEP_ORDER[idx + 1]);
  };

  return (
    <main
      style={{
        position: 'fixed', inset: 0,
        background: 'radial-gradient(circle at 50% 40%, rgba(10,20,36,0.55) 0%, rgba(5,10,20,0.72) 70%)',
        color: 'var(--hud-cyan, #00d4ff)',
        fontFamily: 'var(--font-orbitron, monospace)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div className="hud-glass" style={{ width: 'min(560px, 92vw)', padding: '2.5rem 2rem', borderRadius: 24 }}>
        <Header step={step} status={status} />
        <div style={{ marginTop: '2rem' }}>
          {step === 'welcome' && <Welcome onNext={advance} />}
          {step === 'openrouter' && <KeyStep
            title="OpenRouter API key"
            subtitle="Tüm LLM çağrıları için. Sadece bu yeterli — diğerleri opsiyonel."
            envKey="OPENROUTER_API_KEY"
            provider="openrouter"
            placeholder="sk-or-v1-…"
            helpUrl="https://openrouter.ai/keys"
            current={status?.keys.OPENROUTER_API_KEY}
            onNext={advance}
          />}
          {step === 'deepgram' && <KeyStep
            title="Deepgram API key (opsiyonel)"
            subtitle="Sesli komut için. Atla → sadece yazılı chat çalışır."
            envKey="DEEPGRAM_API_KEY"
            provider="deepgram"
            placeholder="Token..."
            helpUrl="https://console.deepgram.com/"
            current={status?.keys.DEEPGRAM_API_KEY}
            onNext={advance}
            optional
          />}
          {step === 'optional' && <KeyStep
            title="OpenAI API key (opsiyonel)"
            subtitle="TTS için (yüksek kalite ses). Atla → macOS `say` kullanılır."
            envKey="OPENAI_API_KEY"
            provider="openai"
            placeholder="sk-..."
            helpUrl="https://platform.openai.com/api-keys"
            current={status?.keys.OPENAI_API_KEY}
            onNext={advance}
            optional
          />}
          {step === 'mcp' && <MCPStep onNext={advance} />}
          {step === 'mic' && <PermissionStep onNext={advance} />}
          {step === 'done' && <DoneStep />}
        </div>
        <Steps current={step} />
      </div>
    </main>
  );
}

function Header({ step, status }: { step: Step; status: SetupStatus | null }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '2rem', letterSpacing: '0.4em' }}>X J A R V I S</div>
      <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: 6, letterSpacing: '0.2em' }}>
        {step === 'welcome' ? 'KURULUM SİHİRBAZI' : `Adım ${STEP_ORDER.indexOf(step)} / ${STEP_ORDER.length - 1}`}
        {status && status.setup_complete ? ' · ✓ minimum yapılandırılmış' : ''}
      </div>
    </div>
  );
}

function Steps({ current }: { current: Step }) {
  const idx = STEP_ORDER.indexOf(current);
  return (
    <div style={{ marginTop: '2rem', display: 'flex', gap: 8, justifyContent: 'center' }}>
      {STEP_ORDER.map((s, i) => (
        <div
          key={s}
          style={{
            width: 22, height: 4, borderRadius: 2,
            background: i <= idx ? 'var(--hud-cyan, #00d4ff)' : '#27272a',
          }}
        />
      ))}
    </div>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ opacity: 0.85 }}>
        XJarvis — sesli kontrol edilen kişisel macOS asistanın. Birkaç anahtarla başlayalım.
      </p>
      <ul style={{ textAlign: 'left', listStyle: 'none', padding: 0, opacity: 0.75, fontSize: '0.85rem' }}>
        <li>· OpenRouter — LLM çağrıları (zorunlu)</li>
        <li>· Deepgram — sesli giriş (opsiyonel)</li>
        <li>· OpenAI — yüksek kalite TTS (opsiyonel)</li>
        <li>· Mikrofon izni — sesli komut için</li>
      </ul>
      <ActionBtn onClick={onNext}>Başla →</ActionBtn>
    </div>
  );
}

function KeyStep(props: {
  title: string;
  subtitle: string;
  envKey: string;
  provider: 'openrouter' | 'deepgram' | 'openai';
  placeholder: string;
  helpUrl: string;
  current?: KeyState;
  onNext: () => void;
  optional?: boolean;
}) {
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    if (!val) {
      if (props.optional) { props.onNext(); return; }
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const validate = await fetch(`${BACKEND}/api/setup/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: props.provider, key: val }),
      });
      const validation = await validate.json();
      if (!validation.ok) {
        setMsg({ ok: false, text: validation.message });
        setBusy(false);
        return;
      }
      await fetch(`${BACKEND}/api/setup/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [props.envKey]: val }),
      });
      setMsg({ ok: true, text: validation.message });
      setTimeout(() => props.onNext(), 600);
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '1.05rem' }}>{props.title}</div>
      <div style={{ opacity: 0.7, fontSize: '0.8rem' }}>{props.subtitle}</div>
      {props.current?.present && (
        <div style={{ fontSize: '0.75rem', color: '#34d399' }}>
          ✓ kayıtlı: {props.current.masked} (üzerine yazmak için yeni anahtar gir)
        </div>
      )}
      <input
        type="password"
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={props.placeholder}
        disabled={busy}
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(var(--hud-rgb),0.3)',
          color: '#fff',
          padding: '0.7rem 1rem',
          borderRadius: 8,
          fontSize: '0.85rem',
          fontFamily: 'monospace',
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <a href={props.helpUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', opacity: 0.6 }}>
          Anahtar al →
        </a>
        <div style={{ display: 'flex', gap: 8 }}>
          {props.optional && (
            <button onClick={() => props.onNext()} style={btnGhost}>Atla</button>
          )}
          <ActionBtn onClick={submit} disabled={busy || (!val && !props.optional)}>
            {busy ? 'Doğrulanıyor…' : props.current?.present && !val ? 'Bu anahtarı koru →' : 'Kaydet ve devam'}
          </ActionBtn>
        </div>
      </div>
      {msg && (
        <div style={{ fontSize: '0.8rem', color: msg.ok ? '#34d399' : '#ef4444' }}>
          {msg.ok ? '✓' : '✗'} {msg.text}
        </div>
      )}
    </div>
  );
}

interface Preset {
  id: string;
  label: string;
  description: string;
  requires_env: string[];
  installed: boolean;
}

function MCPStep({ onNext }: { onNext: () => void }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND}/api/mcp/presets`)
      .then((r) => r.json())
      .then((data) => {
        const list = (data.presets || []) as Preset[];
        setPresets(list);
        // Auto-suggest: pre-select presets with no required env that aren't installed
        const auto = new Set(
          list.filter((p) => p.requires_env.length === 0 && !p.installed).map((p) => p.id),
        );
        setSelected(auto);
      })
      .catch(() => {});
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const install = async () => {
    setBusy(true);
    try {
      for (const id of selected) {
        const preset = presets.find((p) => p.id === id);
        if (!preset || preset.installed) continue;
        if (preset.requires_env.length > 0) continue;  // skip ones needing input
        await fetch(`${BACKEND}/api/mcp/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, env: {} }),
        });
      }
    } finally {
      setBusy(false);
      onNext();
    }
  };

  const installable = presets.filter((p) => p.requires_env.length === 0);
  const advancedCount = presets.filter((p) => p.requires_env.length > 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '1.05rem' }}>MCP araçlar (opsiyonel)</div>
      <div style={{ opacity: 0.7, fontSize: '0.8rem' }}>
        XJarvis'in yetenekleri MCP server'larla genişler. Sıfır-yapılandırma olanları kur, sonra istersen Preferences'tan daha fazlasını ekle.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        {installable.map((p) => (
          <label
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '0.6rem 0.85rem',
              borderRadius: 8,
              background: selected.has(p.id) ? 'rgba(var(--hud-rgb),0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${selected.has(p.id) ? 'rgba(var(--hud-rgb),0.4)' : 'rgba(255,255,255,0.1)'}`,
              cursor: p.installed ? 'default' : 'pointer',
              opacity: p.installed ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={p.installed || selected.has(p.id)}
              onChange={() => !p.installed && toggle(p.id)}
              disabled={p.installed}
              style={{ marginTop: 2, accentColor: '#00d4ff' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              <span style={{ fontSize: '0.85rem' }}>
                {p.installed && <span style={{ color: '#34d399', marginRight: 6 }}>✓</span>}
                {p.label}
              </span>
              <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>{p.description}</span>
            </div>
          </label>
        ))}
      </div>
      {advancedCount > 0 && (
        <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>
          + {advancedCount} server token gerektiriyor (GitHub, Slack…) — kurulumdan sonra Preferences → MCP Servers'tan ekle.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onNext} style={btnGhost}>Atla</button>
        <ActionBtn onClick={install} disabled={busy || selected.size === 0}>
          {busy ? 'Kuruluyor…' : selected.size === 0 ? 'Devam' : `${selected.size} server'ı kur ve devam`}
        </ActionBtn>
      </div>
    </div>
  );
}

function PermissionStep({ onNext }: { onNext: () => void }) {
  const [granted, setGranted] = useState<boolean | null>(null);

  const ask = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setGranted(true);
    } catch {
      setGranted(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '1.05rem' }}>Mikrofon izni</div>
      <div style={{ opacity: 0.7, fontSize: '0.8rem' }}>
        Sesli komutlar için tarayıcının mikrofona erişmesi gerek. macOS Sistem Tercihleri → Güvenlik & Gizlilik → Mikrofon listesinde Terminal/Tauri'ye de izin verilmesi gerekebilir.
      </div>
      {granted === true && (
        <div style={{ color: '#34d399', fontSize: '0.85rem' }}>✓ izin verildi</div>
      )}
      {granted === false && (
        <div style={{ color: '#ef4444', fontSize: '0.85rem' }}>✗ izin reddedildi — System Settings → Privacy → Microphone'dan manuel etkinleştir</div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onNext} style={btnGhost}>Atla</button>
        <ActionBtn onClick={granted === true ? onNext : ask}>
          {granted === true ? 'Devam →' : 'İzin iste'}
        </ActionBtn>
      </div>
    </div>
  );
}

function DoneStep() {
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: '2rem' }}>✓</div>
      <div style={{ fontSize: '1.05rem' }}>Hazırsın efendim.</div>
      <div style={{ opacity: 0.7, fontSize: '0.85rem' }}>
        Sesli komutlar için <code>python3 -m voice.service</code>, agent için <code>python3 -m agent.service</code> çalışır durumda olmalı.
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <a href="/dashboard" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}>Dashboard</a>
        <a href="/mobile" style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}>Mobile</a>
        <a href="/settings" style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}>Ayarlar</a>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
  color: '#001a26',
  border: 'none',
  padding: '0.6rem 1.2rem',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.85rem',
  letterSpacing: '0.05em',
};
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--hud-cyan, #00d4ff)',
  border: '1px solid rgba(var(--hud-rgb),0.4)',
  padding: '0.6rem 1.2rem',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: '0.85rem',
};

function ActionBtn({ onClick, disabled, children }: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...btnPrimary, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      {children}
    </button>
  );
}
