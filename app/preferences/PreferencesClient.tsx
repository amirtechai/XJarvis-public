'use client';

import { useEffect, useState } from 'react';
import { MCPSection } from './MCPSection';
import { SkillsSection } from './SkillsSection';
import { PermissionsSection } from './PermissionsSection';
import { RoutingSection } from './RoutingSection';
import { TelegramSection } from './TelegramSection';
import { WakeSection } from './WakeSection';
import { VoiceSection } from './VoiceSection';
import { WhatsAppSection } from './WhatsAppSection';
import { SystemUtilsSection } from './SystemUtilsSection';
import { AppearanceSection } from './AppearanceSection';
import { ModelSection } from './ModelSection';
import { PersonaSection } from './PersonaSection';
import { ComputerUseSection } from './ComputerUseSection';
import { VisionDetectSection } from './VisionDetectSection';
import { VoiceCloneSection } from './VoiceCloneSection';
import { UpdateSection } from './UpdateSection';

import { BACKEND } from '@/lib/backend';

interface KeyState {
  present: boolean;
  masked: string;
}
interface Status {
  keys: Record<string, KeyState>;
  services: { agent: boolean; voice: boolean; vision: boolean };
}
interface Settings {
  LLM_DEFAULT: string;
  LLM_HEAVY: string;
  LLM_FREE: string;
  LLM_DAILY_CAP_USD: string;
  STT_LANGUAGE: string;
}

const MODEL_PRESETS = [
  { label: 'Gemini 2.5 Flash Lite (default, $0.10/1M)', value: 'google/gemini-2.5-flash-lite' },
  { label: 'Gemini 2.5 Flash ($0.30/1M)', value: 'google/gemini-2.5-flash' },
  { label: 'DeepSeek V3.2 ($0.25/1M)', value: 'deepseek/deepseek-v3.2' },
  { label: 'DeepSeek Chat v3 ($0.32/1M)', value: 'deepseek/deepseek-chat' },
  { label: 'Gemma 3 27B (free)', value: 'google/gemma-3-27b-it:free' },
  { label: 'Gemma 4 31B (free)', value: 'google/gemma-4-31b-it:free' },
];

export function PreferencesClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const refresh = () => {
    Promise.all([
      fetch(`${BACKEND}/api/setup/status`).then((r) => r.json()),
      fetch(`${BACKEND}/api/setup/settings`).then((r) => r.json()),
    ])
      .then(([s, t]) => { setStatus(s); setSettings(t); })
      .catch(() => {});
  };

  useEffect(refresh, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await fetch(`${BACKEND}/api/setup/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
      refresh();
    }
  };

  const setField = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    if (!settings) return;
    setSettings({ ...settings, [k]: v });
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '3rem 2rem',
        background: 'radial-gradient(circle at 50% 0%, #0a1424 0%, #050a14 70%)',
        color: 'var(--hud-cyan, #00d4ff)',
        fontFamily: 'var(--font-orbitron, monospace)',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <header style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', letterSpacing: '0.4em' }}>SETTINGS</div>
          <div style={{ marginTop: 6, fontSize: '0.7rem', opacity: 0.6 }}>
            Backend: {BACKEND} · Agent: {status?.services.agent ? '✓' : '✗'} ·
            Voice: {status?.services.voice ? '✓' : '✗'} · Vision: {status?.services.vision ? '✓' : '✗'}
          </div>
        </header>

        <Section title="Software Update">
          <UpdateSection />
        </Section>

        <Section title="Persona">
          <PersonaSection />
        </Section>

        <Section title="Voice Clone (ElevenLabs)">
          <VoiceCloneSection />
        </Section>

        <Section title="Computer Use (FULL MODE)">
          <ComputerUseSection />
        </Section>

        <Section title="Vision Detection">
          <VisionDetectSection />
        </Section>

        <Section title="Aktif Model (LLM)">
          <ModelSection />
        </Section>

        <Section title="Görünüm (Tema)">
          <AppearanceSection />
        </Section>

        <Section title="API Keys">
          <KeyRow label="OpenRouter (LLM)"      state={status?.keys.OPENROUTER_API_KEY} />
          <KeyRow label="Deepgram (STT)"        state={status?.keys.DEEPGRAM_API_KEY} />
          <KeyRow label="OpenAI (TTS)"          state={status?.keys.OPENAI_API_KEY} />
          <KeyRow label="Picovoice (wake word)" state={status?.keys.PICOVOICE_ACCESS_KEY} />
          <a href="/onboarding" style={{ ...linkBtn, marginTop: 8 }}>Anahtar ekle / değiştir →</a>
        </Section>

        <Section title="macOS Permissions">
          <PermissionsSection />
        </Section>

        <Section title="MCP Servers">
          <MCPSection />
        </Section>

        <Section title="Skills">
          <SkillsSection />
        </Section>

        <Section title="Telegram Bridge">
          <TelegramSection />
        </Section>

        <Section title="Wake Word">
          <WakeSection />
        </Section>

        <Section title="XJarvis Sesi">
          <VoiceSection />
        </Section>

        <Section title="WhatsApp Bridge">
          <WhatsAppSection />
        </Section>

        <Section title="System Utilities">
          <SystemUtilsSection />
        </Section>

        <Section title="Routing & Servers">
          <RoutingSection />
        </Section>

        {settings && (
          <Section title="LLM Routing">
            <Field label="Default model (chat + simple)">
              <ModelSelect value={settings.LLM_DEFAULT} onChange={(v) => setField('LLM_DEFAULT', v)} />
            </Field>
            <Field label="Heavy model (multi-step / planning)">
              <ModelSelect value={settings.LLM_HEAVY} onChange={(v) => setField('LLM_HEAVY', v)} />
            </Field>
            <Field label="Free fallback (cap aşılırsa)">
              <ModelSelect value={settings.LLM_FREE} onChange={(v) => setField('LLM_FREE', v)} freeOnly />
            </Field>
            <Field label="Günlük harcama cap'i (USD)">
              <input
                type="number" step="0.5" min="0"
                value={settings.LLM_DAILY_CAP_USD}
                onChange={(e) => setField('LLM_DAILY_CAP_USD', e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="STT language">
              <select
                value={settings.STT_LANGUAGE}
                onChange={(e) => setField('STT_LANGUAGE', e.target.value)}
                style={inputStyle}
              >
                <option value="tr">Türkçe (tr)</option>
                <option value="en">English (en)</option>
                <option value="multi">Multilingual (multi)</option>
              </select>
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 12 }}>
              {savedAt && Date.now() - savedAt < 3000 && (
                <span style={{ fontSize: '0.75rem', color: '#34d399' }}>✓ kaydedildi</span>
              )}
              <button onClick={save} disabled={saving} style={primaryBtn}>
                {saving ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </Section>
        )}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="hud-glass" style={{ padding: '1.5rem', borderRadius: 16 }}>
      <div style={{ fontSize: '0.75rem', letterSpacing: '0.2em', opacity: 0.7, marginBottom: 16 }}>
        {title.toUpperCase()}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{label}</div>
      {children}
    </div>
  );
}

function KeyRow({ label, state }: { label: string; state?: KeyState }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ opacity: 0.8 }}>{label}</span>
      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: state?.present ? '#34d399' : '#71717a' }}>
        {state?.present ? `✓ ${state.masked}` : '— eksik'}
      </span>
    </div>
  );
}

function ModelSelect({ value, onChange, freeOnly }: { value: string; onChange: (v: string) => void; freeOnly?: boolean }) {
  const options = freeOnly ? MODEL_PRESETS.filter((m) => m.value.includes(':free')) : MODEL_PRESETS;
  const isPreset = options.some((o) => o.value === value);
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <select
        value={isPreset ? value : '__custom__'}
        onChange={(e) => onChange(e.target.value === '__custom__' ? value : e.target.value)}
        style={{ ...inputStyle, flex: 1 }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value="__custom__">Custom…</option>
      </select>
      {!isPreset && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="provider/model-id"
          style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: '0.8rem' }}
        />
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(var(--hud-rgb),0.3)',
  color: '#fff',
  padding: '0.55rem 0.85rem',
  borderRadius: 8,
  fontSize: '0.85rem',
};
const primaryBtn: React.CSSProperties = {
  background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
  color: '#001a26',
  border: 'none',
  padding: '0.55rem 1.4rem',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.85rem',
};
const linkBtn: React.CSSProperties = {
  display: 'inline-block',
  fontSize: '0.8rem',
  color: 'var(--hud-cyan, #00d4ff)',
  textDecoration: 'none',
  border: '1px solid rgba(var(--hud-rgb),0.3)',
  padding: '0.4rem 0.8rem',
  borderRadius: 6,
  alignSelf: 'flex-start',
};
