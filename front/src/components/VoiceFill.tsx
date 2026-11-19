import { Loader2, Mic, Square } from 'lucide-react';
import { useState } from 'react';

import { ApiError, post } from '@/lib/api';
import { useAppConfig, useCars } from '@/lib/catalog';
import { parseSpokenListing } from '@/lib/listing-parse';
import { useI18n } from '@/lib/i18n';
import { useDictation } from '@/lib/speech';
import type { Category, Condition, Fitment } from '@/lib/types';

import { cx, useToast } from './ui';

/** The selling form's fields from what the seller said; null where they said nothing. */
export interface SpokenFields {
  name: string | null;
  category: Category | null;
  condition: Condition | null;
  isOriginal: boolean | null;
  partNumber: string | null;
  price: number | null;
  description: string | null;
  fitsAllCars: boolean;
  fitments: Fitment[];
}

/**
 * "Speak and we fill": the seller says the whole part in one go (what it is,
 * the cars, condition, price) and the form is filled in for them to check.
 * Claude sorts it on the server when it has a key; otherwise, or if that
 * fails, a free reader in the browser does. Not shown where the browser can't listen.
 */
export function VoiceFill({ onFilled }: { onFilled: (fields: SpokenFields) => void }) {
  const cars = useCars();
  const { tr, lang } = useI18n();
  const toast = useToast();
  const smart = useAppConfig().data?.features?.voiceListing ?? false;
  const [sorting, setSorting] = useState(false);

  const sort = async (text: string) => {
    const locally = () => onFilled(parseSpokenListing(text, cars));
    if (!smart) {
      locally();
      return;
    }
    setSorting(true);
    try {
      onFilled(await post<SpokenFields>('/listing-from-speech', { text: text.slice(0, 1000) }));
    } catch (error) {
      // Signed out, limit reached: say so. The server's reader failing: the free one instead.
      if (error instanceof ApiError && error.status > 0 && error.status < 500) toast(error.message);
      else locally();
    } finally {
      setSorting(false);
    }
  };
  const dictation = useDictation(sort, { lang, long: true });
  if (!dictation.supported) return null;

  const busy = dictation.listening || sorting;
  return (
    <div className={cx('rounded-2xl p-4 ring-1 transition', dictation.listening ? 'bg-red-50 ring-red-200' : 'bg-orange-mist ring-orange/20')}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
          disabled={sorting}
          aria-pressed={dictation.listening}
          aria-label={dictation.listening ? tr('خلصت', 'Done') : tr('اتكلم وإحنا نملا', 'Speak and we fill it in')}
          className={cx(
            'flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-md transition disabled:opacity-70',
            dictation.listening ? 'animate-pulse bg-red-600' : 'bg-orange hover:bg-orange-deep',
          )}
        >
          {sorting ? <Loader2 className="h-6 w-6 animate-spin" /> : dictation.listening ? <Square className="h-5 w-5 fill-current" /> : <Mic className="h-7 w-7" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-navy">
            {sorting ? tr('بنملا الخانات…', 'Filling in the fields…') : dictation.listening ? tr('بنسمعك… دوس لما تخلص', 'Listening… tap when done') : tr('اتكلم وإحنا نملا', 'Speak and we fill it in')}
          </p>
          <p className="text-sm leading-6 text-ink-soft">
            {dictation.listening && dictation.heard
              ? dictation.heard
              : busy
                ? ''
                : tr('قول القطعة والعربيات والحالة والسعر مرة واحدة، مثلاً: "مارش تويوتا كورولا من 2014 لـ 2018، مستعمل أصلي، بـ 1800 جنيه"', 'Say the part, cars, condition and price in one go')}
          </p>
        </div>
      </div>
      {dictation.error && dictation.error !== 'no-speech' && !busy && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {dictation.error === 'denied' ? tr('اسمح للموقع يستخدم المايك من إعدادات المتصفح.', 'Allow the microphone for this site in your browser settings.') : tr('المايك مشتغلش، جرّب تاني.', "The microphone didn't work, try again.")}
        </p>
      )}
    </div>
  );
}
