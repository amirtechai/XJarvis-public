'use client';

import { useEffect, useRef, useState } from 'react';
import { Page, Section, Card, Button, Textarea, Select, Field, Badge, useToast } from '@/components/ui';

import { BACKEND } from '@/lib/backend';

interface Decision {
  category: string; title: string; body: string; due?: string; rationale?: string;
}
interface Result {
  ok: boolean; decision?: Decision;
  target_result?: { ok?: boolean; output?: string; error?: string };
  error?: string;
}

const CATEGORIES = [
  { key: 'auto', label: 'Otomatik (LLM karar verir)' },
  { key: 'reminder', label: 'Hatırlatıcı' },
  { key: 'task', label: 'Görev' },
  { key: 'note', label: 'Not' },
  { key: 'journal', label: 'Günlük' },
  { key: 'knowledge', label: 'Bilgi' },
];

const CATEGORY_VARIANT: Record<string, 'success' | 'warning' | 'info'> = {
  reminder: 'warning', task: 'warning', note: 'info', journal: 'info', knowledge: 'success',
};

export default function QuickCapturePage() {
  const [text, setText] = useState('');
  const [type, setType] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Result | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const toast = useToast();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const r: Result = await fetch(`${BACKEND}/api/quick-capture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, type }),
    }).then((x) => x.json()).catch((e) => ({ ok: false, error: (e as Error).message }));
    setBusy(false);
    setLast(r);
    if (r.ok && r.decision) {
      toast.push(`${r.decision.category} olarak kaydedildi: ${r.decision.title}`, 'success');
      setText('');
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      toast.push(r.error || 'Kaydedilemedi', 'error');
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
  };

  return (
    <Page
      icon="✏️"
      title="Quick Capture"
      subtitle="Aklına geleni yaz, JARVIS uygun yere kaydetsin · Cmd+Enter"
      maxWidth={680}
    >
      <Card variant="glass" glow style={{ padding: 20 }}>
        <Field label="İçerik">
          <Textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="Yarın 14:00'da Ahmet'i ara…&#10;veya  bugün moralim iyi, koştum…&#10;veya  Plaid sandbox key'leri sk_live_…"
            style={{ minHeight: 140, fontSize: 14 }}
          />
        </Field>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field label="Kategori">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 6, paddingBottom: 12 }}>
            <Button
              variant="primary"
              onClick={submit}
              disabled={!text.trim()}
              loading={busy}
            >
              {busy ? 'Kaydediliyor' : 'Yakala'}
            </Button>
          </div>
        </div>
      </Card>

      {last?.ok && last.decision && (
        <Section>
          <Card variant="glass" style={{ padding: 16, animation: 'fade-in 320ms ease-out both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Badge variant={CATEGORY_VARIANT[last.decision.category] || 'info'}>
                {last.decision.category}
              </Badge>
              <span className="hud-font" style={{
                fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-secondary)',
              }}>
                ✓ KAYDEDİLDİ
              </span>
            </div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{last.decision.title}</div>
            {last.decision.due && (
              <div style={{ fontSize: 11, color: 'var(--hud-amber)', marginBottom: 4 }}>
                ⏰ {last.decision.due}
              </div>
            )}
            {last.decision.rationale && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, opacity: 0.7 }}>
                💭 {last.decision.rationale}
              </div>
            )}
          </Card>
        </Section>
      )}
    </Page>
  );
}
