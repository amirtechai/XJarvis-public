'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface TelegramState {
  configured: boolean;
  allowlist: number[];
  last_error: string | null;
}

export function TelegramSection() {
  const [state, setState] = useState<TelegramState | null>(null);
  const [token, setToken] = useState('');
  const [allowlist, setAllowlist] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testChatId, setTestChatId] = useState('');

  const refresh = async () => {
    try {
      const r = await fetch(`${BACKEND}/api/telegram/state`, { cache: 'no-store' });
      if (r.ok) {
        const data = (await r.json()) as TelegramState;
        setState(data);
        setAllowlist(data.allowlist.join(', '));
      }
    } catch { /* offline */ }
  };

  useEffect(() => { refresh(); }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const ids = allowlist.split(/[,\s]+/).map((s) => Number(s.trim())).filter(Number.isFinite);
      const r = await fetch(`${BACKEND}/api/telegram/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, allowlist: ids }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setMsg({ ok: false, text: data.error || 'kaydedilemedi' });
        return;
      }
      const botName = data.bot?.username ? `@${data.bot.username}` : 'bot';
      setMsg({ ok: true, text: `✓ ${botName} kaydedildi (${ids.length} chat ID izinli)` });
      setToken('');  // never echo back the token
      await refresh();
    } finally { setBusy(false); }
  };

  const testSend = async () => {
    const id = Number(testChatId);
    if (!Number.isFinite(id)) { alert('Geçerli chat ID gir.'); return; }
    setBusy(true);
    try {
      const r = await fetch(`${BACKEND}/api/telegram/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id }),
      });
      const data = await r.json();
      setMsg({
        ok: !!data.ok,
        text: data.ok ? '✓ test mesajı gönderildi' : (data.error || 'gönderilemedi'),
      });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
        Telegram bot kurarsan telefondan/uzak XJarvis'e mesaj gönderebilirsin.
        <br />
        <span style={{ opacity: 0.6 }}>
          1. <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: '#00d4ff' }}>@BotFather</a>'da yeni bot yarat → token al.
          2. Botla bir mesaj at, sonra <a href="https://api.telegram.org/bot{TOKEN}/getUpdates" target="_blank" rel="noreferrer" style={{ color: '#00d4ff' }}>getUpdates</a>'ten chat ID'yi öğren.
          3. Aşağıya yapıştır.
        </span>
      </div>

      {state && (
        <div style={{ fontSize: '0.78rem' }}>
          Durum: {state.configured ? <span style={{ color: '#34d399' }}>✓ aktif</span> : <span style={{ opacity: 0.6 }}>— kurulu değil</span>}
          {state.allowlist.length > 0 && (
            <span style={{ opacity: 0.6 }}> · {state.allowlist.length} chat: {state.allowlist.join(', ')}</span>
          )}
          {state.last_error && (
            <div style={{ color: '#ef4444', fontSize: '0.72rem', marginTop: 4 }}>son hata: {state.last_error}</div>
          )}
        </div>
      )}

      <input
        type="password"
        placeholder={state?.configured ? 'Yeni token (mevcudu üzerine yaz)' : 'Bot token (123456:AAA…)'}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        style={inputStyle}
      />
      <textarea
        placeholder="İzinli chat ID'leri (virgülle veya boşlukla ayır, örn: 123456789, -1001234)"
        value={allowlist}
        onChange={(e) => setAllowlist(e.target.value)}
        rows={2}
        style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={save} disabled={busy || !token} style={primaryBtn}>
          {busy ? '…' : 'Kaydet'}
        </button>
      </div>

      {state?.configured && (
        <div style={{
          padding: '0.7rem 0.9rem',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(var(--hud-rgb),0.15)',
          borderRadius: 8,
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <input
            placeholder="chat_id"
            value={testChatId}
            onChange={(e) => setTestChatId(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={testSend} disabled={busy || !testChatId} style={ghostBtn}>
            Test mesajı gönder
          </button>
        </div>
      )}

      {msg && (
        <div style={{ fontSize: '0.78rem', color: msg.ok ? '#34d399' : '#ef4444' }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(var(--hud-rgb),0.3)',
  color: '#fff',
  padding: '0.5rem 0.85rem',
  borderRadius: 6,
  fontSize: '0.85rem',
};
const primaryBtn: React.CSSProperties = {
  background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
  color: '#001a26',
  border: 'none',
  padding: '0.45rem 1.2rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.8rem',
};
const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--hud-cyan, #00d4ff)',
  border: '1px solid rgba(var(--hud-rgb),0.4)',
  padding: '0.45rem 0.9rem',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.78rem',
};
