'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

export type VoiceState = 'idle' | 'listening' | 'speaking';

interface UseVoiceOptions {
  onTranscript: (text: string) => void;
  lang?: string;
}

export function useVoice({ onTranscript, lang = 'tr-TR' }: UseVoiceOptions) {
  const [state, setState] = useState<VoiceState>('idle');
  const [supported, setSupported] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const wakeWordMode = useRef(true);
  const synthesis = useRef<SpeechSynthesis | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SR) {
      console.warn('[voice] SpeechRecognition not supported');
      return;
    }

    setSupported(true);
    synthesis.current = window.speechSynthesis;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = lang;
    recognitionRef.current = rec;

    // Wake-word matcher tolerates Turkish ASR mishearings:
    //   "selam jarvis", "hey jarvis", "jarvis", "carvis", "carwiş", "yarvis"…
    const WAKE_RE = /\b(?:hey\s+)?(?:selam\s+)?[jygc]ar[vbw][iıîşs]\w*/i;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      const last = event.results[event.results.length - 1];
      if (!last.isFinal) return;

      const transcript = last[0].transcript.trim();
      if (!transcript) return;

      const wakeMatch = transcript.match(WAKE_RE);

      if (wakeWordMode.current) {
        if (!wakeMatch) return;
        const after = transcript.slice(wakeMatch.index! + wakeMatch[0].length).trim();
        if (after) {
          // "hey jarvis aç safari" → komut aynı transcript içinde, hemen yolla
          setState('listening');
          onTranscriptRef.current(after);
          // wake mode açık kalır, sıradaki için tekrar uyandırma gerekir
          setTimeout(() => setState('idle'), 80);
        } else {
          // sadece "jarvis" → komut için bekle
          wakeWordMode.current = false;
          setState('listening');
        }
        return;
      }

      // listening modda: olası leading "jarvis" payını at, kalanı yolla
      const cleaned = wakeMatch
        ? transcript.slice(wakeMatch.index! + wakeMatch[0].length).trim() || transcript
        : transcript;
      wakeWordMode.current = true;
      setState('idle');
      onTranscriptRef.current(cleaned);
    };

    rec.onend = () => {
      // Daima yeniden başlat — wake-word veya listening fark etmez
      try { rec.start(); } catch { /* already started */ }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      const err = e?.error || 'unknown';
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        console.warn('[voice] microphone permission denied');
        setSupported(false);
        return;
      }
      // 'no-speech' / 'aborted' / 'network' → sadece yeniden başlat
      console.debug('[voice] error:', err);
    };

    try { rec.start(); } catch { /* ignore */ }

    return () => {
      try { rec.stop(); } catch { /* ignore */ }
    };
  }, [lang]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || !supported) return;
    wakeWordMode.current = false;
    setState('listening');
  }, [supported]);

  const stopListening = useCallback(() => {
    wakeWordMode.current = true;
    setState('idle');
  }, []);

  const speak = useCallback((text: string) => {
    if (!synthesis.current) return;
    synthesis.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.05;

    setState('speaking');
    utterance.onend = () => setState('idle');
    utterance.onerror = () => setState('idle');

    synthesis.current.speak(utterance);
  }, [lang]);

  const stopSpeaking = useCallback(() => {
    synthesis.current?.cancel();
    setState('idle');
  }, []);

  return { state, supported, startListening, stopListening, speak, stopSpeaking };
}
