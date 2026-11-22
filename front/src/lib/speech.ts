import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speech to text with the browser's own recogniser (Chrome, Edge, Safari):
 * free, in Egyptian Arabic. Browsers without one get no microphone buttons.
 */

interface RecognitionResult extends ArrayLike<{ transcript: string; confidence?: number }> {
  readonly isFinal: boolean;
}
interface RecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
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
 * [long] keeps listening through pauses, for a whole sentence or two, even on
 * phones whose recogniser gives up at the first breath. [choose] picks the
 * likeliest of the recogniser's guesses for each stretch of speech.
 */
export function useDictation(
  onDone: (text: string) => void,
  { lang = 'ar', long = false, choose }: { lang?: 'ar' | 'en'; long?: boolean; choose?: (guesses: string[]) => string } = {},
) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<DictationError | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const stopped = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;
  const pick = useRef(choose);
  pick.current = choose;

  const stop = useCallback(() => {
    stopped.current = true;
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!Recogniser) return;
    active?.abort();
    stopped.current = false;
    const began = Date.now();
    let final = '';
    let failed: DictationError | null = null;

    /** The best guess of one result: [choose]'s, else the recogniser's first. */
    const best = (result: RecognitionResult) => {
      const guesses = Array.from({ length: result.length }, (_, i) => result[i]!.transcript.trim()).filter(Boolean);
      if (guesses.length > 1 && pick.current) return pick.current(guesses);
      return guesses[0] ?? '';
    };

    const listen = () => {
      const r = new Recogniser!();
      r.lang = lang === 'ar' ? 'ar-EG' : 'en-US';
      r.continuous = long;
      r.interimResults = true;
      r.maxAlternatives = pick.current ? 5 : 1;
      // What this session has heard, final or not: the words said just before
      // "stop" often never become final, and are kept anyway.
      let sessionFinal = '';
      let interim = '';
      r.onresult = (event) => {
        interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]!;
          if (result.isFinal) sessionFinal += `${best(result)} `;
          else interim += result[0]?.transcript ?? '';
        }
        setHeard(`${final}${sessionFinal}${interim}`.trim());
      };
      r.onerror = (event) => {
        // Aborted: another microphone took over, or the page went away.
        if (event.error === 'aborted') stopped.current = true;
        failed = event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'denied' : event.error === 'no-speech' ? 'no-speech' : event.error === 'aborted' ? null : 'failed';
      };
      r.onend = () => {
        final += sessionFinal + (interim ? `${interim} ` : '');
        // A phone ending a long dictation at a pause: carry on, until the
        // speaker stops it, stays quiet, or a minute and a half has gone by.
        const goOn = long && !stopped.current && !failed && sessionFinal + interim !== '' && Date.now() - began < 90_000;
        if (goOn && recognition.current === r) {
          try {
            listen();
            return;
          } catch {
            // Fall through and finish with what was heard.
          }
        }
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
      r.start();
    };

    setError(null);
    setHeard('');
    setListening(true);
    try {
      listen();
    } catch {
      recognition.current = null;
      setListening(false);
      setError('failed');
    }
  }, [lang, long]);

  // Leaving the page stops the microphone.
  useEffect(
    () => () => {
      stopped.current = true;
      recognition.current?.abort();
    },
    [],
  );

  return { supported: Boolean(Recogniser), listening, heard, error, start, stop };
}
