'use client';

import { useEffect, useState } from 'react';

import { BACKEND } from '@/lib/backend';

interface CliclickState { installed: boolean; path: string | null }
interface ReminderState { enabled: boolean; pinged_count: number }
interface BriefState { enabled: boolean; time: string; last_sent_day?: string }
interface InsightState { enabled: boolean; time: string; last_sent_day?: string }
interface HeartbeatState {
  enabled: boolean; interval_min: number;
  quiet_start: string; quiet_end: string; cooldown_min: number;
  last_beat_at?: number;
  recent?: { ts: number; action: string; summary?: string; reason?: string }[];
}

export function SystemUtilsSection() {
  const [cli, setCli] = useState<CliclickState | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [rem, setRem] = useState<ReminderState | null>(null);
  const [brief, setBrief] = useState<BriefState | null>(null);
  const [briefMsg, setBriefMsg] = useState<string | null>(null);
  const [insight, setInsight] = useState<InsightState | null>(null);
  const [insightMsg, setInsightMsg] = useState<string | null>(null);
  const [meetingMsg, setMeetingMsg] = useState<string | null>(null);
  const [hb, setHb] = useState<HeartbeatState | null>(null);
  const [hbMsg, setHbMsg] = useState<string | null>(null);

  const refresh = () => {
    fetch(`${BACKEND}/api/cliclick/state`).then((r) => r.json()).then(setCli).catch(() => {});
    fetch(`${BACKEND}/api/reminders-watcher/state`).then((r) => r.json()).then(setRem).catch(() => {});
    fetch(`${BACKEND}/api/morning-brief/state`).then((r) => r.json()).then(setBrief).catch(() => {});
    fetch(`${BACKEND}/api/insights/config`).then((r) => r.json()).then(setInsight).catch(() => {});
    fetch(`${BACKEND}/api/heartbeat/config`).then((r) => r.json()).then(setHb).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  const install = async () => {
    setInstalling(true); setInstallMsg(null);
    try {
      const r = await fetch(`${BACKEND}/api/cliclick/install`, { method: 'POST' }).then((x) => x.json());
      if (r.ok) {
        setInstallMsg('cliclick yüklendi.');
        setCli(r.state);
      } else {
        setInstallMsg(`Hata: ${r.error || 'unknown'}`);
      }
    } catch (e: unknown) {
      setInstallMsg(`Hata: ${(e as Error).message}`);
    } finally { setInstalling(false); }
  };

  const toggleReminders = async (enabled: boolean) => {
    const r = await fetch(`${BACKEND}/api/reminders-watcher/toggle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).then((x) => x.json());
    if (r.ok) setRem(r.state);
  };

  const saveBrief = async (patch: Partial<BriefState>) => {
    const r = await fetch(`${BACKEND}/api/morning-brief/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((x) => x.json());
    if (r.ok) setBrief(r.state);
  };

  const sendBriefNow = async () => {
    setBriefMsg('Gönderiliyor…');
    const r = await fetch(`${BACKEND}/api/morning-brief/send-now`, { method: 'POST' }).then((x) => x.json());
    setBriefMsg(r.ok ? 'Telegram\'a gönderildi.' : `Hata: ${r.error || 'unknown'}`);
  };

  const saveInsight = async (patch: Partial<InsightState>) => {
    const r = await fetch(`${BACKEND}/api/insights/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((x) => x.json());
    setInsight(r);
  };

  const sendInsightNow = async () => {
    setInsightMsg('Hesaplanıyor…');
    const r = await fetch(`${BACKEND}/api/insights/send`, { method: 'POST' }).then((x) => x.json());
    if (r.empty) setInsightMsg('Bugün gönderilecek insight yok.');
    else setInsightMsg(r.ok ? `${r.count} insight gönderildi.` : `Hata: ${r.error || 'unknown'}`);
  };

  const sendMeetingBriefNow = async () => {
    setMeetingMsg('Hazırlanıyor…');
    const r = await fetch(`${BACKEND}/api/meeting-brief/send`, { method: 'POST' }).then((x) => x.json());
    setMeetingMsg(r.ok ? 'Sıradaki toplantı brief\'i gönderildi.' : `Hata: ${r.error || 'unknown'}`);
  };

  const saveHb = async (patch: Partial<HeartbeatState>) => {
    const r = await fetch(`${BACKEND}/api/heartbeat/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((x) => x.json());
    setHb(r);
  };
  const runHbDry = async () => {
    setHbMsg('Beat çalışıyor…');
    const r = await fetch(`${BACKEND}/api/heartbeat/dry-run`, { method: 'POST' }).then((x) => x.json());
    if (r.skipped) setHbMsg(`Skipped: ${r.skipped}`);
    else if (r.decision?.action === 'notify') setHbMsg(`[dry] notify: ${r.decision.summary || ''} — ${(r.decision.message || '').slice(0, 120)}`);
    else setHbMsg(`[dry] none — ${r.decision?.reason || 'no signal'}`);
  };

  const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' } as const;
  const btn = { padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13 } as const;

  return (
    <div>
      <div style={row}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>cliclick (mouse simulate)</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {cli?.installed ? `✓ Yüklü — ${cli.path}` : '✗ Yüklü değil'}
          </div>
          {installMsg && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{installMsg}</div>}
        </div>
        {!cli?.installed && (
          <button style={btn} disabled={installing} onClick={install}>
            {installing ? 'Yükleniyor…' : 'brew install cliclick'}
          </button>
        )}
      </div>

      <div style={row}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Morning brief → Telegram</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Her sabah belirtilen saatte: bugünün etkinlikleri, okunmamış mail, hatırlatıcılar, hava.
            {brief?.last_sent_day && <> · son: {brief.last_sent_day}</>}
          </div>
          {briefMsg && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{briefMsg}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="time"
            value={brief?.time || '08:00'}
            onChange={(e) => saveBrief({ time: e.target.value })}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', color: 'var(--text-primary)', fontSize: 13 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!brief?.enabled}
              onChange={(e) => saveBrief({ enabled: e.target.checked })}
            />
            {brief?.enabled ? 'Açık' : 'Kapalı'}
          </label>
          <button style={btn} onClick={sendBriefNow}>Şimdi gönder</button>
        </div>
      </div>

      <div style={row}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>🫀 Proactive heartbeat (LLM brain)</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Saatte bir bağlamı (calendar, mail, recovery, reminders) LLM'e verir, gerekirse Telegram'a proaktif mesaj atar. Quiet hours ve cooldown ile spam korumalı.
          </div>
          {hbMsg && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{hbMsg}</div>}
          {hb?.recent && hb.recent.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, opacity: 0.7 }}>
              Son: {hb.recent.slice(0, 3).map((r) => `${r.action}${r.summary ? `(${r.summary})` : ''}`).join(' · ')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input
            type="number" min={5} max={240} value={hb?.interval_min || 60}
            onChange={(e) => saveHb({ interval_min: Number(e.target.value) })}
            style={{ width: 56, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }}
            title="Interval (min)"
          />
          <input
            type="time" value={hb?.quiet_start || '23:00'}
            onChange={(e) => saveHb({ quiet_start: e.target.value })}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }}
            title="Quiet start"
          />
          <input
            type="time" value={hb?.quiet_end || '08:00'}
            onChange={(e) => saveHb({ quiet_end: e.target.value })}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }}
            title="Quiet end"
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!hb?.enabled} onChange={(e) => saveHb({ enabled: e.target.checked })} />
            {hb?.enabled ? 'Açık' : 'Kapalı'}
          </label>
          <button style={btn} onClick={runHbDry}>Dry-run</button>
        </div>
      </div>

      <div style={row}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Meeting brief (cross-connector)</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Sıradaki Calendar toplantısı 15 dk öncesi: katılımcılar + Granola notları + son maillerden
            otomatik özet → Telegram. Manuel tetikleme:
          </div>
          {meetingMsg && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{meetingMsg}</div>}
        </div>
        <button style={btn} onClick={sendMeetingBriefNow}>Şimdi gönder</button>
      </div>

      <div style={row}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Daily insights → Telegram</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            WHOOP recovery × calendar yoğunluğu, uyku × kafein uyarısı, inbox aşırılığı vb.
            Pattern bulunca akşam mesaj atar.
            {insight?.last_sent_day && <> · son: {insight.last_sent_day}</>}
          </div>
          {insightMsg && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{insightMsg}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="time"
            value={insight?.time || '20:00'}
            onChange={(e) => saveInsight({ time: e.target.value })}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', color: 'var(--text-primary)', fontSize: 13 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!insight?.enabled}
              onChange={(e) => saveInsight({ enabled: e.target.checked })}
            />
            {insight?.enabled ? 'Açık' : 'Kapalı'}
          </label>
          <button style={btn} onClick={sendInsightNow}>Şimdi gönder</button>
        </div>
      </div>

      <div style={row}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Reminders → Telegram ping</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Vadesi gelen hatırlatıcılar Telegram'a otomatik bildir (60s polling).
            {rem && <> Pinged: {rem.pinged_count}</>}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!rem?.enabled}
            onChange={(e) => toggleReminders(e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>{rem?.enabled ? 'Açık' : 'Kapalı'}</span>
        </label>
      </div>
    </div>
  );
}
