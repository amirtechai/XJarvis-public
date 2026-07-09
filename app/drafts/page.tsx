'use client';

import { useEffect, useState } from 'react';
import { Page, Card, Button, Textarea, Badge, Empty, Skeleton, useToast } from '@/components/ui';

import { BACKEND } from '@/lib/backend';

interface Draft {
  id: number; subject: string; sender: string; snippet: string;
  draft: string; rationale: string; status: string; ts: number;
}

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState<number | 'refresh' | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const toast = useToast();

  const refresh = () => fetch(`${BACKEND}/api/email-drafts`).then((r) => r.json()).then(setDrafts).catch(() => setDrafts([]));
  useEffect(() => { refresh(); }, []);

  const runRefresh = async () => {
    setBusy('refresh');
    const r = await fetch(`${BACKEND}/api/email-drafts/refresh`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
    setBusy(null);
    if (r?.ok) toast.push(`${r.added || 0} yeni taslak`, 'success');
    else toast.push('Taslak üretilemedi', 'error');
    refresh();
  };

  const approve = async (id: number) => {
    setBusy(id);
    const r = await fetch(`${BACKEND}/api/email-drafts/${id}/approve`, { method: 'POST' }).then((x) => x.json());
    setBusy(null);
    if (r?.ok) toast.push('Mail.app\'de açıldı', 'success');
    else toast.push('Açılamadı', 'error');
    refresh();
  };

  const dismiss = async (id: number) => {
    await fetch(`${BACKEND}/api/email-drafts/${id}/dismiss`, { method: 'POST' });
    toast.push('Atıldı', 'info');
    refresh();
  };

  const saveEdit = async (id: number) => {
    await fetch(`${BACKEND}/api/email-drafts/${id}/edit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: editText }),
    });
    toast.push('Kaydedildi', 'success');
    setEditId(null); setEditText('');
    refresh();
  };

  return (
    <Page
      icon="📨"
      title="Email Drafts"
      subtitle="Apple Mail'den gelen kişisel mailler için LLM cevap taslakları"
      actions={
        <Button variant="primary" onClick={runRefresh} loading={busy === 'refresh'}>
          Inbox'tan yeni
        </Button>
      }
    >
      {drafts === null ? (
        <Card><Skeleton width="50%" height={16} style={{ marginBottom: 8 }} /><Skeleton width="80%" height={12} /></Card>
      ) : drafts.length === 0 ? (
        <Empty
          icon="✉"
          title="Taslak yok"
          hint="Yukarıdaki butonla Apple Mail inbox'ında okunmamış kişisel mailler için cevap taslakları üret."
        />
      ) : (
        drafts.map((d) => (
          <Card key={d.id} variant="glass" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.subject}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.sender}
                </div>
                {d.rationale && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 5, opacity: 0.7, fontStyle: 'italic' }}>
                    💭 {d.rationale}
                  </div>
                )}
              </div>
              <Badge variant={d.status === 'approved' ? 'success' : 'info'}>
                {d.status === 'approved' ? '✓ Mail\'de' : 'Pending'}
              </Badge>
            </div>

            {editId === d.id ? (
              <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} style={{ minHeight: 160 }} />
            ) : (
              <div style={{
                background: 'rgba(0,8,20,0.5)', padding: 12, borderRadius: 6,
                fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                border: '1px solid rgba(var(--hud-rgb),0.08)',
              }}>
                {d.draft}
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              {editId === d.id ? (
                <>
                  <Button variant="primary" size="sm" onClick={() => saveEdit(d.id)}>Kaydet</Button>
                  <Button variant="ghost" size="sm" onClick={() => { setEditId(null); setEditText(''); }}>İptal</Button>
                </>
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => approve(d.id)}
                    loading={busy === d.id}
                    disabled={d.status === 'approved'}
                  >
                    ✓ Mail.app'de aç
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => { setEditId(d.id); setEditText(d.draft); }}>
                    Düzenle
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => dismiss(d.id)}>Geç</Button>
                </>
              )}
            </div>
          </Card>
        ))
      )}
    </Page>
  );
}
