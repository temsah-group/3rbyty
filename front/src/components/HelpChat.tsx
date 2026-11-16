import { MessageCircleQuestion } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useAppConfig } from '@/lib/catalog';
import { useI18n } from '@/lib/i18n';

// The chat itself loads on the first tap: the button costs the page almost nothing.
const HelpChatPanel = lazy(() => import('./HelpChatPanel'));

/** Pages with their own buttons along the bottom, or where a chat would distract. */
const QUIET_PATHS = /^\/(sell|login|register|verify|forgot-password|reset-password)(\/|$)/;

/**
 * "Ask 3arabity": a round button in the corner that opens the help chat.
 * Only there when the server has the assistant switched on.
 */
export function HelpChat() {
  const { tr } = useI18n();
  const { pathname } = useLocation();
  const enabled = useAppConfig().data?.features?.assistant ?? false;
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!enabled) return null;
  return (
    <>
      {!open && !QUIET_PATHS.test(pathname) && (
        <button
          onClick={() => {
            setLoaded(true);
            setOpen(true);
          }}
          onPointerEnter={() => setLoaded(true)}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] end-4 z-30 flex h-14 items-center gap-2 rounded-full bg-navy px-4 text-white shadow-lg ring-4 ring-white/70 transition hover:bg-navy-deep md:bottom-6 md:end-6"
          aria-label={tr('اسأل مساعد عربيتي', 'Ask the 3arabity assistant')}
        >
          <MessageCircleQuestion className="h-6 w-6" />
          <span className="hidden text-sm font-extrabold sm:inline">{tr('عندك سؤال؟', 'Questions?')}</span>
        </button>
      )}
      {loaded && (
        <Suspense fallback={null}>
          <HelpChatPanel open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
