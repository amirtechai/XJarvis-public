'use client';

import { useEffect, useState } from 'react';
import { Page, Section, Card, Button, Input, Field, Badge, ProgressBar, Empty, Skeleton, useToast } from '@/components/ui';

import { BACKEND } from '@/lib/backend';

interface Checkin { id: number; ts: string; summary: string; progress_pct: number; llm_note: string }
interface Goal {
  id: number; title: string; why: string; deadline: string | null;
  progress_pct: number; status: string; signal_query: string;
  created_at: string; updated_at: string;
  recent_checkins?: Checkin[];
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [draft, setDraft] = useState({ title: '', why: '', deadline: '', signal_query: '' });
  const [busy, setBusy] = useState<number | 'create' | 'review' | null>(null);
  const toast = useToast();

  const refresh = () => fetch(`${BACKEND}/api/goals`).then((r) => r.json()).then(setGoals).catch(() => setGoals([]));
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!draft.title.trim()) return;
    setBusy('create');
    const res = await fetch(`${BACKEND}/api/goals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setBusy(null);
    if (res.ok) {
      toast.push('Hedef eklendi', 'success');
      setDraft({ title: '', why: '', deadline: '', signal_query: '' });
      refresh();
    } else {
      toast.push('Hedef eklenemedi', 'error');
    }
  };

  const checkin = async (id: number) => {
    setBusy(id);
    const r = await fetch(`${BACKEND}/api/goals/${id}/checkin`, { method: 'POST' }).then((x) => x.json());
    setBusy(null);
    if (r?.decision) toast.push(`Check-in: ${r.decision.progress_pct ?? '?'}%`, 'success');
    else toast.push('Check-in başarısız', 'error');
    refresh();
  };

  const archive = async (id: number) => {
    await fetch(`${BACKEND}/api/goals/${id}`, { method: 'DELETE' });
    toast.push('Arşivlendi', 'info');
    refresh();
  };

  const weeklyReview = async () => {
    setBusy('review');
    const r = await fetch(`${BACKEND}/api/goals/weekly-review`, { method: 'POST' }).then((x) => x.json());
    setBusy(null);
    if (r.empty) toast.push('Aktif hedef yok', 'info');
    else if (r.ok) toast.push(`${r.reviews} hedef özeti gönderildi`, 'success');
    else toast.push(`Hata: ${r.error}`, 'error');
    refresh();
  };

  return (
    <Page
      icon="🎯"
      title="Goals & OKR"
      subtitle="Uzun vadeli hedeflerin — JARVIS connector verilerinden ilerleme çıkarır"
      actions={
        <Button variant="secondary" onClick={weeklyReview} loading={busy === 'review'}>
          Haftalık özet
        </Button>
      }
    >
      <Section title="Yeni hedef">
        <Card variant="glass" glow>
          <Field label="Başlık">
            <Input placeholder="Örn: Bu çeyrek 8 kg vermek"
              value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Neden? (motivasyon)">
            <Input placeholder="Hedefin ardındaki sebep"
              value={draft.why} onChange={(e) => setDraft({ ...draft, why: e.target.value })} />
          </Field>
          <Field label="Sinyal sorgusu" hint="Connector'larda hangi kelime ilerlemeyi gösterir?">
            <Input placeholder="koşu, antrenman, kalori"
              value={draft.signal_query} onChange={(e) => setDraft({ ...draft, signal_query: e.target.value })} />
          </Field>
          <Field label="Bitiş tarihi (opsiyonel)">
            <Input type="date" value={draft.deadline}
              onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
          </Field>
          <Button variant="primary" onClick={create} loading={busy === 'create'} disabled={!draft.title.trim()}>
            Ekle
          </Button>
        </Card>
      </Section>

      <Section title="Aktif hedefler">
        {goals === null ? (
          <Card><Skeleton width="60%" height={18} style={{ marginBottom: 8 }} /><Skeleton height={4} /></Card>
        ) : goals.length === 0 ? (
          <Empty icon="◎" title="Henüz hedef yok" hint="Yukarıdaki forma ilk hedefini ekle." />
        ) : (
          goals.map((g) => (
            <Card key={g.id} variant="glass" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{g.title}</div>
                  {g.why && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{g.why}</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {g.deadline && <Badge variant="warning">⏰ {g.deadline}</Badge>}
                    {g.signal_query && <Badge variant="info">🔍 {g.signal_query}</Badge>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="hud-font" style={{
                    fontSize: 28, fontWeight: 700, color: 'var(--hud-cyan)',
                    textShadow: '0 0 12px rgba(var(--hud-rgb),0.45)', lineHeight: 1,
                  }}>{g.progress_pct}%</div>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <ProgressBar value={g.progress_pct} />
              </div>
              {g.recent_checkins && g.recent_checkins.length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(var(--hud-rgb),0.12)' }}>
                  {g.recent_checkins.slice(0, 2).map((c) => (
                    <div key={c.id} style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
                      <span className="hud-font" style={{
                        fontSize: 10, color: 'var(--hud-cyan)', letterSpacing: '0.14em',
                        marginRight: 8,
                      }}>{new Date(c.ts).toLocaleDateString('tr-TR')}</span>
                      <span>{c.summary}</span>
                      {c.llm_note && <div style={{ color: 'var(--text-secondary)', marginTop: 3, fontSize: 11 }}>→ {c.llm_note}</div>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <Button onClick={() => checkin(g.id)} loading={busy === g.id} variant="secondary" size="sm">
                  Check-in
                </Button>
                <Button onClick={() => archive(g.id)} variant="danger" size="sm">Arşivle</Button>
              </div>
            </Card>
          ))
        )}
      </Section>
    </Page>
  );
}
