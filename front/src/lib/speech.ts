import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speech to text with the browser's own recogniser (Chrome, Edge, Safari):
 * free, in Egyptian Arabic. Browsers without one get no microphone buttons.
 */

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface RecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionClass = new () => Recognition;

const Recogniser: RecognitionClass | undefined =
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecognitionClass }).webkitSpeechRecognition);

export const speechSupported = () => Boolean(Recogniser);

/** One microphone at a time: starting one stops the other. */
let active: Recognition | null = null;

export type DictationError = 'denied' | 'no-speech' | 'failed';

/**
 * Listens until the speaker stops (or [stop] is called), showing what it hears
 * so far in [heard], then hands the whole of what was said to [onDone].
 * [long] keeps listening through short pauses, for a whole sentence or two.
 */
export function useDictation(onDone: (text: string) => void, { lang = 'ar', long = false }: { lang?: 'ar' | 'en'; long?: boolean } = {}) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<DictationError | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const stop = useCallback(() => recognition.current?.stop(), []);

  const start = useCallback(() => {
    if (!Recogniser) return;
    active?.abort();
    const r = new Recogniser();
    r.lang = lang === 'ar' ? 'ar-EG' : 'en-US';
    r.continuous = long;
    r.interimResults = true;
    let final = '';
    let failed: DictationError | null = null;
    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) final += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      setHeard(`${final}${interim}`.trim());
    };
    r.onerror = (event) => {
      failed = event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'denied' : event.error === 'no-speech' ? 'no-speech' : event.error === 'aborted' ? null : 'failed';
    };
    r.onend = () => {
      if (active === r) active = null;
      recognition.current = null;
      setListening(false);
      setHeard('');
      const text = final.replace(/\s+/g, ' ').trim();
      if (text) done.current(text);
      else setError(failed ?? 'no-speech');
    };
    recognition.current = r;
    active = r;
    setError(null);
    setHeard('');
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
      setError('failed');
    }
  }, [lang, long]);

  // Leaving the page stops the microphone.
  useEffect(() => () => recognition.current?.abort(), []);

  return { supported: Boolean(Recogniser), listening, heard, error, start, stop };
}
