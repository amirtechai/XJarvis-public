'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface SkillPreset {
  id: string;
  label: string;
  description: string;
  installed: boolean;
}
interface InstalledSkill {
  name: string;
  file: string;
  size: number;
}

export function SkillsSection() {
  const [presets, setPresets] = useState<SkillPreset[]>([]);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ name: string; content: string } | null>(null);

  const load = async () => {
    const [a, b] = await Promise.all([
      fetch(`${BACKEND}/api/skills/presets`).then((r) => r.json()),
      fetch(`${BACKEND}/api/skills/installed`).then((r) => r.json()),
    ]);
    setPresets(a.presets || []);
    setInstalled(b.skills || []);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditor({
      name: '',
      content: `---
name: my-skill
description: Bu skill ne yapar (1 cümle)
---

# Skill Adı

Kullanıcı X dediğinde:

1. Adım 1
2. Adım 2

Çıktı formatı: ...`,
    });
  };

  const openEdit = async (name: string) => {
    const r = await fetch(`${BACKEND}/api/skills/file?name=${encodeURIComponent(name)}`);
    const j = await r.json();
    if (r.ok) setEditor({ name, content: j.content || '' });
  };

  const save = async () => {
    if (!editor) return;
    const name = editor.name.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) { alert('Geçerli bir isim gir (a-z, 0-9, -_).'); return; }
    setBusy(name);
    try {
      await fetch(`${BACKEND}/api/skills/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: editor.content }),
      });
      await load();
      setEditor(null);
    } finally { setBusy(null); }
  };

  const install = async (id: string) => {
    setBusy(id);
    try {
      await fetch(`${BACKEND}/api/skills/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    } finally { setBusy(null); }
  };

  const remove = async (name: string) => {
    if (!confirm(`'${name}' skill'ini sil?`)) return;
    setBusy(name);
    try {
      await fetch(`${BACKEND}/api/skills`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await load();
    } finally { setBusy(null); }
  };

  const presetIds = new Set(presets.map((p) => p.id));
  const customSkills = installed.filter((s) => !presetIds.has(s.name));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: '0.75rem', opacity: 0.7, flex: 1 }}>
          Skills agent'a hazır iş akışları ekler. Markdown'lar agent/skills/ altında durur.
          Kurulumdan sonra agent'ı yeniden başlat (tray → Restart).
        </div>
        <button onClick={openNew} style={primaryBtn}>+ Yeni Skill</button>
      </div>

      <div style={{ fontSize: '0.7rem', letterSpacing: '0.15em', opacity: 0.5 }}>HAZIR SKILLS</div>
      {presets.map((p) => (
        <div
          key={p.id}
          style={{
            padding: '0.8rem 1rem',
            borderRadius: 10,
            background: p.installed ? 'rgba(52,211,153,0.06)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${p.installed ? 'rgba(52,211,153,0.3)' : 'rgba(var(--hud-rgb),0.15)'}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: '0.9rem' }}>
              {p.installed && <span style={{ color: '#34d399', marginRight: 6 }}>✓</span>}
              {p.label}
            </span>
            <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>{p.description}</span>
          </div>
          {p.installed ? (
            <button onClick={() => remove(p.id)} disabled={busy === p.id} style={dangerBtn}>
              {busy === p.id ? '…' : 'Sil'}
            </button>
          ) : (
            <button onClick={() => install(p.id)} disabled={busy === p.id} style={primaryBtn}>
              {busy === p.id ? '…' : 'Kur'}
            </button>
          )}
        </div>
      ))}

      {customSkills.length > 0 && (
        <>
          <div style={{ fontSize: '0.7rem', letterSpacing: '0.15em', opacity: 0.5, marginTop: 8 }}>
            ÖZEL SKILLS
          </div>
          {customSkills.map((s) => (
            <div
              key={s.name}
              style={{
                padding: '0.6rem 0.85rem',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: '0.8rem',
              }}
            >
              <span style={{ flex: 1, fontFamily: 'monospace' }}>{s.name}.md</span>
              <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>{s.size}B</span>
              <button onClick={() => openEdit(s.name)} disabled={busy === s.name} style={ghostBtn}>
                Düzenle
              </button>
              <button onClick={() => remove(s.name)} disabled={busy === s.name} style={dangerBtn}>
                {busy === s.name ? '…' : 'Sil'}
              </button>
            </div>
          ))}
        </>
      )}

      {editor && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditor(null); }}
        >
          <div
            className="hud-glass"
            style={{
              background: '#0a1424',
              borderRadius: 12,
              width: 'min(720px, 95vw)',
              maxHeight: '90vh',
              padding: '1.5rem',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Skill name:</span>
              <input
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                placeholder="my-skill"
                style={{ ...inputStyle, flex: 1 }}
                autoFocus
              />
              <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>.md</span>
            </div>
            <textarea
              value={editor.content}
              onChange={(e) => setEditor({ ...editor, content: e.target.value })}
              spellCheck={false}
              style={{
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(var(--hud-rgb),0.2)',
                color: '#e4e4e7',
                padding: '0.85rem',
                borderRadius: 6,
                fontSize: '0.8rem',
                fontFamily: 'ui-monospace, monospace',
                lineHeight: 1.5,
                resize: 'vertical',
                minHeight: 320,
                flex: 1,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setEditor(null)} style={ghostBtn}>İptal</button>
              <button onClick={save} disabled={!!busy} style={primaryBtn}>
                {busy ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--hud-cyan, #00d4ff)',
  border: '1px solid rgba(var(--hud-rgb),0.4)',
  padding: '0.4rem 0.8rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.78rem',
};
const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(var(--hud-rgb),0.3)',
  color: '#fff',
  padding: '0.5rem 0.75rem',
  borderRadius: 6,
  fontSize: '0.85rem',
  fontFamily: 'monospace',
};

const primaryBtn: React.CSSProperties = {
  background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
  color: '#001a26',
  border: 'none',
  padding: '0.4rem 1rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.8rem',
};
const dangerBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#ef4444',
  border: '1px solid rgba(239,68,68,0.4)',
  padding: '0.4rem 1rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.8rem',
};
