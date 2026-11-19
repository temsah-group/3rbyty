import { Mic, Square } from 'lucide-react';
import { useEffect } from 'react';

import { useI18n } from '@/lib/i18n';
import { useDictation } from '@/lib/speech';

import { cx, useToast } from './ui';

/**
 * A small microphone beside a field: tap, speak, and what was said is handed
 * to [onText] (the field adds it). Not shown where the browser can't listen.
 */
export function MicButton({ onText, label, className }: { onText: (text: string) => void; label: string; className?: string }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const dictation = useDictation(onText, { lang });

  useEffect(() => {
    if (dictation.error === 'denied') toast(tr('اسمح للموقع يستخدم المايك من إعدادات المتصفح', 'Allow the microphone for this site in your browser settings'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.error]);

  if (!dictation.supported) return null;
  return (
    <button
      type="button"
      onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
      aria-label={dictation.listening ? tr('وقّف التسجيل', 'Stop recording') : label}
      aria-pressed={dictation.listening}
      title={label}
      className={cx(
        'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 transition',
        dictation.listening ? 'animate-pulse bg-red-600 text-white ring-red-600' : 'bg-white text-navy ring-line hover:ring-navy',
        className,
      )}
    >
      {dictation.listening ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
    </button>
  );
}
