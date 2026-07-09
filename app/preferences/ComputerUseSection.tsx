'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface State {
  enabled: boolean;
  full_mode: boolean;
  blocked_actions: string[];
}

export function ComputerUseSection() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);

  const load = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/computer-use/state`);
      const j = await r.json();
      if (j.ok) setState(j);
    } catch { /* noop */ }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (patch: Partial<State>) => {
    setBusy(true);
    try {
      await fetch(`${BACKEND}/api/computer-use/toggle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await load();
    } finally { setBusy(false); }
  };

  const dispatch = async () => {
    if (!goal.trim() || running) return;
    setRunning(true);
    try {
      const r = await fetch(`${BACKEND}/api/computer-use/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
      });
      const j = await r.json();
      if (j.ok) {
        alert(`Computer Use agent başlatıldı: ${j.run_id}\n/agents sayfasından izle.`);
        setGoal('');
      } else {
        alert(j.error || 'failed');
      }
    } finally { setRunning(false); }
  };

  if (!state) return <div style={{ opacity: 0.5, fontSize: 11 }}>Yükleniyor…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '0.75rem', opacity: 0.7, lineHeight: 1.5 }}>
        ⚠ Computer Use Anthropic&apos;in API&apos;si üzerinden agent&apos;a senin
        bilgisayarını kontrol ettirir — fare/klavye/screenshot. <strong>FULL MODE</strong>
        açıkken silme/kapama gibi tehlikeli aksiyonlar dışında her şeyi onay almadan yapar.
        Tehlikeli aksiyon listesi: {state.blocked_actions.join(', ')}.
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Toggle
          label="Computer Use ENABLED"
          on={state.enabled}
          onClick={() => !busy && toggle({ enabled: !state.enabled })}
          color="#34d399"
        />
        <Toggle
          label="FULL MODE (no confirmation)"
          on={state.full_mode}
          onClick={() => !busy && toggle({ full_mode: !state.full_mode })}
          color="#fbbf24"
          disabled={!state.enabled}
        />
      </div>

      {state.enabled && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={goal} onChange={(e) => setGoal(e.target.value)}
            placeholder="Hedef yaz: 'Safari'de quartile.io'yu aç ve dashboard sayfasına git'…"
            style={{
              flex: 1, padding: '8px 12px', fontSize: 12,
              background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', borderRadius: 4, fontFamily: 'inherit',
            }}
          />
          <button
            onClick={dispatch} disabled={running || !goal.trim()}
            style={{
              padding: '8px 18px', fontSize: 11, letterSpacing: '0.16em',
              background: 'rgba(252,211,77,0.18)',
              border: '1px solid rgba(252,211,77,0.5)',
              color: '#fbbf24', borderRadius: 4,
              cursor: running ? 'wait' : 'pointer',
              fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 700,
            }}
          >▶ DISPATCH</button>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, on, onClick, color, disabled }: {
  label: string; on: boolean; onClick: () => void; color: string; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        padding: '6px 14px', fontSize: 11, letterSpacing: '0.1em',
        background: on ? `${color}25` : 'transparent',
        border: `1px solid ${on ? color : 'rgba(255,255,255,0.18)'}`,
        color: disabled ? '#666' : (on ? color : 'var(--text-secondary)'),
        borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', textTransform: 'uppercase', fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
      }}
    >{on ? '✓ ' : '○ '}{label}</button>
  );
}
