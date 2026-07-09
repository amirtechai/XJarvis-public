'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface Connection {
  ok: boolean;
  user?: { id: string; name?: string; type?: string };
  error?: string;
}

interface NotionPageMeta {
  id: string;
  url?: string;
  object: 'page' | 'database';
  archived?: boolean;
  created_time?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
  parent?: { type: string };
  icon?: { type: string; emoji?: string };
}

interface NotionBlock {
  id: string;
  type: string;
  paragraph?: { rich_text: Array<{ plain_text: string }> };
  heading_1?: { rich_text: Array<{ plain_text: string }> };
  heading_2?: { rich_text: Array<{ plain_text: string }> };
  heading_3?: { rich_text: Array<{ plain_text: string }> };
  bulleted_list_item?: { rich_text: Array<{ plain_text: string }> };
  numbered_list_item?: { rich_text: Array<{ plain_text: string }> };
  to_do?: { rich_text: Array<{ plain_text: string }>; checked?: boolean };
  code?: { rich_text: Array<{ plain_text: string }>; language?: string };
  divider?: Record<string, never>;
}

function pageTitle(p: NotionPageMeta): string {
  const props = p.properties as Record<string, { title?: Array<{ plain_text?: string }>; type?: string }> | undefined;
  if (!props) return 'Untitled';
  for (const v of Object.values(props)) {
    if (v?.type === 'title' && Array.isArray(v.title) && v.title.length) {
      return v.title.map((t) => t.plain_text || '').join('') || 'Untitled';
    }
  }
  return 'Untitled';
}

function blockToText(b: NotionBlock): string {
  const arr = b.paragraph?.rich_text || b.heading_1?.rich_text || b.heading_2?.rich_text ||
              b.heading_3?.rich_text || b.bulleted_list_item?.rich_text ||
              b.numbered_list_item?.rich_text || b.to_do?.rich_text || b.code?.rich_text || [];
  return arr.map((t) => t.plain_text || '').join('');
}

function blockToMarkdown(b: NotionBlock): string {
  const text = blockToText(b);
  switch (b.type) {
    case 'heading_1': return `# ${text}`;
    case 'heading_2': return `## ${text}`;
    case 'heading_3': return `### ${text}`;
    case 'bulleted_list_item': return `- ${text}`;
    case 'numbered_list_item': return `1. ${text}`;
    case 'to_do': return `- [${b.to_do?.checked ? 'x' : ' '}] ${text}`;
    case 'code': return '```' + (b.code?.language || '') + '\n' + text + '\n```';
    case 'divider': return '---';
    default: return text;
  }
}

export function NotionClient() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [results, setResults] = useState<NotionPageMeta[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageMeta, setPageMeta] = useState<NotionPageMeta | null>(null);
  const [pageBlocks, setPageBlocks] = useState<NotionBlock[]>([]);
  const [editorContent, setEditorContent] = useState('');
  const [editorTitle, setEditorTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    fetch(`${BACKEND}/api/notion/connection`).then((r) => r.json()).then(setConn).catch(() => setConn({ ok: false, error: 'backend down' }));
  }, []);

  const refreshList = useCallback(async (q: string) => {
    try {
      const r = await fetch(`${BACKEND}/api/notion/search?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      setResults(d?.results || []);
    } catch { setResults([]); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (conn?.ok) refreshList(''); }, [conn?.ok, refreshList]);

  useEffect(() => {
    const t = setTimeout(() => { if (conn?.ok) refreshList(query); }, 300);
    return () => clearTimeout(t);
  }, [query, conn?.ok, refreshList]);

  const loadPage = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/notion/page/${id}`);
      const d = await r.json();
      setPageMeta(d?.meta || null);
      setPageBlocks(d?.blocks || []);
      setEditorTitle(d?.meta ? pageTitle(d.meta) : '');
      setEditorContent((d?.blocks || []).map(blockToMarkdown).join('\n'));
    } catch { showToast('Sayfa yüklenemedi'); }
    finally { setLoading(false); }
  }, [showToast]);

  const saveAppend = useCallback(async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const body: { title?: string; append?: string } = {};
      if (pageMeta && editorTitle && editorTitle !== pageTitle(pageMeta)) body.title = editorTitle;
      // Append only NEW lines (everything below current rendered markdown)
      const current = pageBlocks.map(blockToMarkdown).join('\n');
      const newPart = editorContent.startsWith(current) ? editorContent.slice(current.length).trimStart() : editorContent;
      if (newPart) body.append = newPart;
      if (!body.title && !body.append) { showToast('Değişiklik yok'); setSaving(false); return; }
      const r = await fetch(`${BACKEND}/api/notion/page/${selectedId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'kayıt hatası');
      showToast('Kaydedildi');
      await loadPage(selectedId);
      refreshList(query);
    } catch (e) {
      showToast((e as Error).message);
    } finally { setSaving(false); }
  }, [selectedId, pageMeta, editorTitle, editorContent, pageBlocks, loadPage, refreshList, query, showToast]);

  const archivePage = useCallback(async () => {
    if (!selectedId) return;
    if (!confirm('Sayfayı arşivle?')) return;
    try {
      const r = await fetch(`${BACKEND}/api/notion/page/${selectedId}`, { method: 'DELETE' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'arşiv hatası');
      showToast('Arşivlendi');
      setSelectedId(null); setPageMeta(null); setPageBlocks([]); setEditorContent(''); setEditorTitle('');
      refreshList(query);
    } catch (e) { showToast((e as Error).message); }
  }, [selectedId, refreshList, query, showToast]);

  const newPage = useCallback(async () => {
    const title = prompt('Yeni sayfa başlığı:');
    if (!title) return;
    // pick first available page result as parent (workspace root requires search)
    const rootCandidate = results.find((r) => r.object === 'page');
    if (!rootCandidate) {
      showToast('Önce integration paylaşılmış bir sayfa olmalı');
      return;
    }
    setCreating(true);
    try {
      const r = await fetch(`${BACKEND}/api/notion/page`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: rootCandidate.id, title, content: '' }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'oluşturma hatası');
      showToast('Sayfa oluşturuldu');
      await refreshList(query);
      if (d.id) loadPage(d.id);
    } catch (e) { showToast((e as Error).message); }
    finally { setCreating(false); }
  }, [results, refreshList, query, loadPage, showToast]);

  // Cmd+N shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); newPage(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveAppend(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newPage, saveAppend]);

  if (conn === null) {
    return <Centered>Bağlantı kontrol ediliyor…</Centered>;
  }
  if (!conn.ok) {
    return (
      <Centered>
        <div style={{ textAlign: 'center', maxWidth: 460 }}>
          <h2 style={{ fontSize: 18, color: 'var(--hud-cyan)', letterSpacing: '0.2em', marginBottom: 12 }}>NOTION BAĞLI DEĞİL</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
            Hata: <code style={{ color: '#ff8888' }}>{conn.error || 'bilinmiyor'}</code>
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 16 }}>
            <strong>Internal integration token</strong> kurulumu için:<br />
            1. <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer" style={{ color: 'var(--hud-cyan)' }}>notion.so/profile/integrations</a> → New integration<br />
            2. Token&apos;ı <code>.env</code> içine <code>NOTION_API_KEY=secret_xxx</code><br />
            3. Notion&apos;da çalışacağın sayfayı integration ile paylaş (&quot;Connections&quot;)<br />
            4. Backend restart
          </p>
        </div>
      </Centered>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--bg-base)' }}>
      {/* SIDEBAR */}
      <aside style={{
        width: 280, flexShrink: 0,
        borderRight: '1px solid rgba(var(--hud-rgb),0.18)',
        display: 'flex', flexDirection: 'column',
        background: 'rgba(0,8,20,0.4)',
      }}>
        <div style={{ padding: 12, borderBottom: '1px solid rgba(var(--hud-rgb),0.1)' }}>
          <input
            ref={titleRef}
            type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Ara…"
            style={{
              width: '100%', padding: '7px 10px', fontSize: 12,
              background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', borderRadius: 4, fontFamily: 'inherit',
            }}
          />
          <button
            onClick={newPage} disabled={creating}
            style={{
              width: '100%', marginTop: 8, padding: '7px 10px',
              fontSize: 10, letterSpacing: '0.18em',
              background: 'rgba(var(--hud-rgb),0.18)',
              border: '1px solid rgba(var(--hud-rgb),0.5)',
              color: 'var(--hud-cyan)', borderRadius: 4, cursor: 'pointer',
              fontFamily: 'inherit', textTransform: 'uppercase',
            }}
          >+ {creating ? 'oluşturuluyor…' : 'YENİ SAYFA (⌘N)'}</button>
          <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 6, letterSpacing: '0.1em' }}>
            ◢ {conn.user?.name || 'connected'} · {results.length} item
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => loadPage(r.id)}
              style={{
                width: '100%', textAlign: 'left',
                padding: '7px 10px', marginBottom: 2,
                fontSize: 12,
                background: selectedId === r.id ? 'rgba(var(--hud-rgb),0.15)' : 'transparent',
                border: `1px solid ${selectedId === r.id ? 'rgba(var(--hud-rgb),0.4)' : 'transparent'}`,
                color: selectedId === r.id ? 'var(--hud-cyan)' : 'var(--text-primary)',
                borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                {r.icon?.emoji || (r.object === 'database' ? '▦' : '◧')}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pageTitle(r)}
              </span>
            </button>
          ))}
          {!results.length && (
            <div style={{ padding: 16, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center' }}>
              Henüz erişim yok. Notion&apos;da bir sayfayı integration ile paylaş.
            </div>
          )}
        </div>
      </aside>

      {/* EDITOR */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!selectedId ? (
          <Centered>Soldan bir sayfa seç veya ⌘N ile yeni oluştur.</Centered>
        ) : loading ? (
          <Centered>Yükleniyor…</Centered>
        ) : (
          <>
            <div style={{
              padding: '14px 20px', display: 'flex', gap: 10, alignItems: 'center',
              borderBottom: '1px solid rgba(var(--hud-rgb),0.12)',
            }}>
              <input
                type="text"
                value={editorTitle}
                onChange={(e) => setEditorTitle(e.target.value)}
                placeholder="Başlık"
                style={{
                  flex: 1, padding: '7px 10px', fontSize: 16,
                  background: 'transparent', border: '1px solid transparent',
                  color: 'var(--text-primary)', borderRadius: 4,
                  fontFamily: 'inherit', fontWeight: 600,
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(var(--hud-rgb),0.3)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
              />
              <button onClick={saveAppend} disabled={saving} style={btnPrimary}>
                {saving ? '…' : 'KAYDET (⌘S)'}
              </button>
              <button onClick={archivePage} style={btnDanger}>ARŞİVLE</button>
              {pageMeta?.url && (
                <a href={pageMeta.url} target="_blank" rel="noreferrer" style={{ ...btnGhost, textDecoration: 'none' }}>
                  AÇ ↗
                </a>
              )}
            </div>
            <textarea
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              placeholder="Markdown formatında yaz. Yeni eklediklerin save'de blok olarak append edilir."
              style={{
                flex: 1, padding: 20, fontSize: 14, lineHeight: 1.6,
                background: 'transparent', border: 'none', resize: 'none',
                color: 'var(--text-primary)', fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
                outline: 'none',
              }}
            />
          </>
        )}
      </main>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
          padding: '10px 16px', background: 'rgba(0,12,24,0.92)',
          border: '1px solid rgba(var(--hud-rgb),0.5)', color: 'var(--hud-cyan)',
          borderRadius: 4, fontSize: 12, letterSpacing: '0.1em',
          boxShadow: '0 0 24px rgba(var(--hud-rgb),0.3)',
        }}>{toast}</div>
      )}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '7px 14px', fontSize: 10, letterSpacing: '0.16em',
  background: 'rgba(var(--hud-rgb),0.18)', border: '1px solid rgba(var(--hud-rgb),0.5)',
  color: 'var(--hud-cyan)', borderRadius: 4, cursor: 'pointer',
  fontFamily: 'inherit', textTransform: 'uppercase',
};
const btnGhost: React.CSSProperties = {
  ...btnPrimary, background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
};
const btnDanger: React.CSSProperties = {
  ...btnPrimary, background: 'rgba(255,80,80,0.1)', color: '#ff8888',
  border: '1px solid rgba(255,80,80,0.3)',
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-secondary)', fontSize: 13,
    }}>{children}</div>
  );
}
