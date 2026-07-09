'use client';
import { useEffect, useState } from 'react';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';

/**
 * Alt çubuk üzerinde, son STT_FINAL (kullanıcı) ve son tamamlanmış JARVIS
 * cevabını canlı gösterir. Named-entity (yer/kişi/para/tarih/risk) renkli.
 *
 * NER: sunucu tarafına yük etmemek için frontend'de hızlı regex tabanlı yaklaşım.
 */

interface Snippet { who: 'user' | 'jarvis'; text: string; ts: number }

const ENTITY_RULES: { re: RegExp; color: string; cls: string }[] = [
  // Para tutarı (₺, $, €, sayı + TL/USD/EUR)
  { re: /(\$|€|£|₺)\s?\d[\d.,]*\s?(milyon|bin|m|k)?|\b\d[\d.,]*\s?(TL|USD|EUR|GBP|TRY)\b/gi, color: '#34d399', cls: 'money' },
  // Tarih / saat
  { re: /\b(\d{1,2}\s?(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)|bugün|yarın|dün|bu (sabah|akşam|gece)|saat \d{1,2}([:.]\d{2})?|şimdi)\b/gi, color: '#fbbf24', cls: 'time' },
  // Risk / tehlike
  { re: /\b(savaş|saldırı|kriz|uyarı|alarm|tehlike|patlama|deprem|yangın|kaza|hata|fail|error|attack|crisis)\b/gi, color: '#ef4444', cls: 'risk' },
  // Yer (kapsamlı liste)
  { re: /\b(İstanbul|Ankara|İzmir|Balıkesir|Türkiye|Avrupa|Amerika|Çin|Rusya|İran|İsrail|Filistin|Suriye|Irak|Almanya|Fransa|İngiltere|Yunanistan|ABD|Bursa|Antalya|Adana)\b/gi, color: '#7dd3fc', cls: 'place' },
  // Kişi (Patron + yaygın isimler)
  { re: /\b(Patron|JARVIS|Trump|Putin|Erdoğan|Biden|Netanyahu|Musk|Bezos|Zuckerberg)\b/gi, color: '#a78bfa', cls: 'person' },
];

function highlight(text: string): React.ReactNode[] {
  if (!text) return [];
  const matches: { start: number; end: number; color: string; word: string }[] = [];
  for (const r of ENTITY_RULES) {
    let m: RegExpExecArray | null;
    const re = new RegExp(r.re.source, r.re.flags);
    while ((m = re.exec(text)) != null) {
      matches.push({ start: m.index, end: m.index + m[0].length, color: r.color, word: m[0] });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  // Çakışmaları temizle
  const dedup: typeof matches = [];
  let last = -1;
  for (const m of matches) {
    if (m.start >= last) { dedup.push(m); last = m.end; }
  }
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < dedup.length; i++) {
    const m = dedup[i];
    if (m.start > cursor) out.push(text.slice(cursor, m.start));
    out.push(
      <span key={i} style={{
        color: m.color, fontWeight: 600,
        textShadow: `0 0 6px ${m.color}80`,
        padding: '0 2px',
      }}>{m.word}</span>
    );
    cursor = m.end;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export function LiveCaption() {
  const [recent, setRecent] = useState<Snippet | null>(null);
  const [respBuffer, setRespBuffer] = useState<string>('');
  const { lastEvent } = useJarvisEvents([
    EVENT_TYPES.STT_FINAL,
    EVENT_TYPES.RESPONSE_CHUNK,
    EVENT_TYPES.RESPONSE_END,
  ]);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.event === EVENT_TYPES.STT_FINAL) {
      const t = ((lastEvent.payload as { text?: string })?.text || '').trim();
      if (t) setRecent({ who: 'user', text: t, ts: Date.now() });
    } else if (lastEvent.event === EVENT_TYPES.RESPONSE_CHUNK) {
      const t = ((lastEvent.payload as { text?: string })?.text || '');
      setRespBuffer((prev) => prev + t);
    } else if (lastEvent.event === EVENT_TYPES.RESPONSE_END) {
      setRespBuffer((prev) => {
        const final = prev.trim();
        if (final) setRecent({ who: 'jarvis', text: final, ts: Date.now() });
        return '';
      });
    }
  }, [lastEvent]);

  // 12 saniye sonra fade out
  useEffect(() => {
    if (!recent) return;
    const t = setTimeout(() => setRecent(null), 12_000);
    return () => clearTimeout(t);
  }, [recent]);

  if (!recent && !respBuffer) return null;
  const text = respBuffer || recent?.text || '';
  const who = respBuffer ? 'jarvis' : recent?.who || 'user';

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: 0, right: 0,
      display: 'flex', justifyContent: 'center',
      pointerEvents: 'none', zIndex: 79,
    }}>
      <div style={{
        maxWidth: '70vw',
        padding: '8px 18px',
        background: 'linear-gradient(180deg, rgba(0,12,24,0.85), rgba(0,8,18,0.92))',
        border: `1px solid rgba(var(--hud-rgb), ${who === 'user' ? 0.45 : 0.7})`,
        borderRadius: 6,
        backdropFilter: 'blur(8px)',
        boxShadow: `0 0 24px rgba(var(--hud-rgb), 0.3)`,
        color: 'var(--hud-cyan)',
        fontFamily: 'var(--font-stack, monospace)',
        fontSize: 14,
        letterSpacing: '0.04em',
        lineHeight: 1.5,
        animation: 'lc-in 220ms ease-out both',
      }}>
        <span style={{
          fontSize: 9, opacity: 0.6, letterSpacing: '0.25em',
          marginRight: 10, textTransform: 'uppercase',
          color: who === 'user' ? '#fde68a' : 'var(--hud-cyan)',
        }}>
          {who === 'user' ? '◉ PATRON' : '◎ JARVIS'}
        </span>
        {highlight(text)}
        {respBuffer && (
          <span style={{ display: 'inline-block', width: 8, marginLeft: 4, animation: 'lc-blink 0.9s step-end infinite' }}>▋</span>
        )}
      </div>
      <style>{`
        @keyframes lc-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes lc-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}
