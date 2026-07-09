/**
 * Türkçe metin → vizem (Oculus viseme) zaman çizelgesi sürücüsü.
 *
 * Webview server-side TTS sesini analiz edemediği için (afplay), lip-sync'i
 * TTS_PLAYBACK_START'ın taşıdığı METİNDEN üretiyoruz. Türkçe ~birebir fonetik
 * olduğundan harf→vizem haritası kelimeleri konuşuyormuş gibi gösterir.
 */

export const VISEMES = [
  'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
  'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
  'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U',
] as const;
export type Viseme = (typeof VISEMES)[number];

// Türkçe harf → Oculus viseme
const MAP: Record<string, Viseme> = {
  a: 'viseme_aa', â: 'viseme_aa', e: 'viseme_E',
  ı: 'viseme_I', i: 'viseme_I', î: 'viseme_I',
  o: 'viseme_O', ö: 'viseme_O', u: 'viseme_U', ü: 'viseme_U', û: 'viseme_U',
  b: 'viseme_PP', p: 'viseme_PP', m: 'viseme_PP',
  f: 'viseme_FF', v: 'viseme_FF',
  d: 'viseme_DD', t: 'viseme_DD',
  n: 'viseme_nn',
  k: 'viseme_kk', g: 'viseme_kk', ğ: 'viseme_kk', h: 'viseme_kk', q: 'viseme_kk',
  c: 'viseme_CH', ç: 'viseme_CH', j: 'viseme_CH',
  s: 'viseme_SS', ş: 'viseme_SS', z: 'viseme_SS', x: 'viseme_SS',
  l: 'viseme_RR', r: 'viseme_RR',
  y: 'viseme_I', w: 'viseme_U',
};
// Sesli harf → çene açıklığı
const OPEN: Record<string, number> = {
  a: 0.72, â: 0.72, e: 0.5, ı: 0.3, i: 0.28, o: 0.58, ö: 0.5, u: 0.42, ü: 0.42,
};

const SLOT_MS = 72; // harf başına ~süre (≈14 karakter/sn Türkçe tempo)

type Slot = { v: Viseme; open: number };

export type LipFrame = { weights: Partial<Record<Viseme, number>>; jaw: number };

export class LipSync {
  private seq: Slot[] = [];
  private start = 0;
  private active = false;

  begin(text: string, nowMs: number) {
    const t = (text || '').toLowerCase();
    const seq: Slot[] = [];
    for (const ch of t) {
      const v = MAP[ch];
      if (v) seq.push({ v, open: OPEN[ch] ?? 0.16 });
      else if (ch === ' ' || ch === ',' || ch === '.' || ch === '\n') seq.push({ v: 'viseme_sil', open: 0 });
    }
    if (!seq.length) seq.push({ v: 'viseme_sil', open: 0 });
    this.seq = seq;
    this.start = nowMs;
    this.active = true;
  }

  stop() { this.active = false; this.seq = []; }
  get isActive() { return this.active; }

  /** O anki vizem ağırlıkları + çene açıklığı (yumuşatma + ön-bağlanma). */
  sample(nowMs: number): LipFrame | null {
    if (!this.active || !this.seq.length) return null;
    const fpos = (nowMs - this.start) / SLOT_MS;
    const i = Math.floor(fpos);
    if (i >= this.seq.length) return { weights: { viseme_sil: 1 }, jaw: 0 };
    const frac = Math.max(0, Math.min(1, fpos - i));
    const cur = this.seq[i];
    const nxt = this.seq[Math.min(i + 1, this.seq.length - 1)];
    const env = Math.sin(frac * Math.PI); // 0→1→0 üçgen zarf
    const weights: Partial<Record<Viseme, number>> = {};
    weights[cur.v] = (weights[cur.v] || 0) + env * 0.85;
    weights[nxt.v] = (weights[nxt.v] || 0) + (1 - env) * 0.22; // ko-artikülasyon
    return { weights, jaw: cur.open * env };
  }
}
