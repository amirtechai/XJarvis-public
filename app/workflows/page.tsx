'use client';

import { useEffect, useState } from 'react';
import { Page, Section, Card, Button, Input, Select, Textarea, Field, Badge, Empty, Skeleton, useToast } from '@/components/ui';

import { BACKEND } from '@/lib/backend';

interface Trigger { type: 'cron' | 'interval' | 'manual'; spec?: string; minutes?: number }
interface Action { type: 'telegram' | 'agent_prompt' | 'shell'; message?: string; prompt?: string; command?: string }
interface Workflow {
  id: number; name: string; trigger: Trigger; action: Action;
  enabled: boolean; last_run_at?: string; last_status?: string;
}

const triggerLabel = (t: Trigger) => {
  if (t.type === 'cron') return `🕐 ${t.spec || ''}`;
  if (t.type === 'interval') return `🔁 ${t.minutes}m`;
  return '✋ Manuel';
};
const actionLabel = (a: Action) => {
  if (a.type === 'telegram') return '📨 Telegram';
  if (a.type === 'agent_prompt') return '🧠 Agent';
  return '🐚 Shell';
};

export default function WorkflowsPage() {
  const [list, setList] = useState<Workflow[] | null>(null);
  const [draft, setDraft] = useState({
    name: '', triggerType: 'cron' as Trigger['type'], spec: '08:00', minutes: 60,
    actionType: 'telegram' as Action['type'], message: '', prompt: '', command: '',
  });
  const toast = useToast();

  const refresh = () => fetch(`${BACKEND}/api/workflows`).then((r) => r.json()).then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!draft.name.trim()) return;
    const trigger: Trigger = draft.triggerType === 'cron'
      ? { type: 'cron', spec: draft.spec }
      : draft.triggerType === 'interval'
      ? { type: 'interval', minutes: Number(draft.minutes) }
      : { type: 'manual' };
    const action: Action = draft.actionType === 'telegram'
      ? { type: 'telegram', message: draft.message }
      : draft.actionType === 'agent_prompt'
      ? { type: 'agent_prompt', prompt: draft.prompt }
      : { type: 'shell', command: draft.command };
    const r = await fetch(`${BACKEND}/api/workflows`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: draft.name, trigger, action }),
    });
    if (r.ok) {
      toast.push('Workflow eklendi', 'success');
      setDraft({ ...draft, name: '', message: '', prompt: '', command: '' });
      refresh();
    } else {
      toast.push('Eklenemedi', 'error');
    }
  };

  const toggle = async (w: Workflow) => {
    await fetch(`${BACKEND}/api/workflows/${w.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !w.enabled }),
    });
    toast.push(w.enabled ? 'Durduruldu' : 'Açıldı', 'info');
    refresh();
  };

  const remove = async (w: Workflow) => {
    await fetch(`${BACKEND}/api/workflows/${w.id}`, { method: 'DELETE' });
    toast.push('Silindi', 'info');
    refresh();
  };

  const runNow = async (w: Workflow) => {
    const r = await fetch(`${BACKEND}/api/workflows/${w.id}/run`, { method: 'POST' }).then((x) => x.json());
    toast.push(r?.ok ? `${w.name} çalıştı` : `Hata: ${r?.error || 'unknown'}`, r?.ok ? 'success' : 'error');
    refresh();
  };

  return (
    <Page
      icon="⚙"
      title="Workflows"
      subtitle="Cron/interval tetikli, Telegram/Agent/Shell aksiyonlu otomatik akışlar"
    >
      <Section title="Yeni workflow">
        <Card variant="glass" glow>
          <Field label="İsim">
            <Input placeholder="Örn: Sabah brief"
              value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
            <Field label="Tetik tipi">
              <Select value={draft.triggerType}
                onChange={(e) => setDraft({ ...draft, triggerType: e.target.value as Trigger['type'] })}>
                <option value="cron">Günlük (HH:MM)</option>
                <option value="interval">Her N dakika</option>
                <option value="manual">Manuel</option>
              </Select>
            </Field>
            {draft.triggerType === 'cron' && (
              <Field label="Saat">
                <Input type="time" value={draft.spec}
                  onChange={(e) => setDraft({ ...draft, spec: e.target.value })} />
              </Field>
            )}
            {draft.triggerType === 'interval' && (
              <Field label="Aralık (dk)">
                <Input type="number" min={1} value={draft.minutes}
                  onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })} />
              </Field>
            )}
            {draft.triggerType === 'manual' && <div />}
          </div>

          <Field label="Aksiyon">
            <Select value={draft.actionType}
              onChange={(e) => setDraft({ ...draft, actionType: e.target.value as Action['type'] })}>
              <option value="telegram">📨 Telegram mesajı gönder</option>
              <option value="agent_prompt">🧠 Agent'a sor + Telegram'a yolla</option>
              <option value="shell">🐚 Shell komutu çalıştır</option>
            </Select>
          </Field>

          {draft.actionType === 'telegram' && (
            <Field label="Mesaj">
              <Textarea placeholder="Telegram'a gönderilecek metin"
                value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
            </Field>
          )}
          {draft.actionType === 'agent_prompt' && (
            <Field label="Prompt" hint="Agent bunu görür ve cevabı Telegram'a gider">
              <Textarea placeholder="Bana bugünün özetini ver"
                value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
            </Field>
          )}
          {draft.actionType === 'shell' && (
            <Field label="Komut">
              <Input placeholder="say 'Saat 14:00'"
                value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
            </Field>
          )}

          <Button variant="primary" onClick={create} disabled={!draft.name.trim()}>Ekle</Button>
        </Card>
      </Section>

      <Section title="Aktif workflows">
        {list === null ? (
          <Card><Skeleton width="40%" height={16} /></Card>
        ) : list.length === 0 ? (
          <Empty icon="⚙" title="Workflow yok" hint="Yukarıdan ilkini oluştur." />
        ) : (
          list.map((w) => (
            <Card key={w.id} variant="glass" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{w.name}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <Badge variant={w.enabled ? 'success' : 'default'}>{w.enabled ? 'Açık' : 'Kapalı'}</Badge>
                    <Badge variant="info">{triggerLabel(w.trigger)}</Badge>
                    <Badge variant="info">{actionLabel(w.action)}</Badge>
                  </div>
                  {w.last_run_at && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.7, marginTop: 6 }}>
                      Son: {new Date(w.last_run_at + 'Z').toLocaleString('tr-TR')} · {w.last_status}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Button variant="secondary" size="sm" onClick={() => runNow(w)}>Çalıştır</Button>
                  <Button variant="ghost" size="sm" onClick={() => toggle(w)}>{w.enabled ? 'Durdur' : 'Aç'}</Button>
                  <Button variant="danger" size="sm" onClick={() => remove(w)}>Sil</Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </Section>
    </Page>
  );
}
