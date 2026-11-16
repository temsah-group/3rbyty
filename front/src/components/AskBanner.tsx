import { ChevronLeft, ChevronRight, MessageSquareReply } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useI18n } from '@/lib/i18n';

import { cx } from './ui';

/** "Can't find it? Ask for it": the way into part requests, on the home page and after search results. */
export function AskBanner({ query, className }: { query?: string | null; className?: string }) {
  const { tr, lang } = useI18n();
  const Arrow = lang === 'ar' ? ChevronLeft : ChevronRight;
  return (
    <Link
      to={`/requests/new${query ? `?q=${encodeURIComponent(query)}` : ''}`}
      className={cx('group flex items-center gap-4 rounded-2xl bg-orange-mist p-5 ring-1 ring-orange/20 transition hover:ring-orange/50', className)}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange text-white">
        <MessageSquareReply className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-extrabold text-navy">{tr('مش لاقي القطعة؟ اطلبها', "Can't find the part? Ask for it")}</span>
        <span className="block text-sm text-ink-soft">{tr('قولنا محتاج إيه، والمحلات اللي بتشتغل على عربيتك ترد عليك بأسعارها.', 'Tell us what you need and the shops that work on your car answer with their prices.')}</span>
      </span>
      <Arrow className="h-5 w-5 shrink-0 text-orange-deep transition group-hover:-translate-x-1 ltr:group-hover:translate-x-1" />
    </Link>
  );
}
