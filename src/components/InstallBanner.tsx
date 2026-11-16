import { Download, Share, SquarePlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useI18n } from '@/lib/i18n';
import { bannerSnoozed, canPrompt, isIosSafari, isStandalone, markInstalled, onInstallChange, promptInstall, snoozeBanner } from '@/lib/install';

import { Button } from './ui';

/** Pages seen, or seconds spent, before asking: never on the first glance. */
const PAGES_BEFORE = 3;
const SECONDS_BEFORE = 40;
/** Where the banner would get in the way of something the visitor is doing. */
const QUIET_PATHS = /^\/(login|register|verify|forgot-password|reset-password|sell)/;

/**
 * A small card above the bottom bar: "Add 3arabity to your home screen".
 * Chrome/Edge open their install dialog; iPhone Safari gets the two taps
 * to do it from the Share menu. Closing it keeps it away for three weeks.
 */
export function InstallBanner() {
  const { tr } = useI18n();
  const { pathname } = useLocation();
  const [promptable, setPromptable] = useState(canPrompt);
  const [engaged, setEngaged] = useState(false);
  const [closed, setClosed] = useState(() => bannerSnoozed());
  const pages = useRef(new Set<string>());
  const ios = useRef(isIosSafari()).current;
  const standalone = useRef(isStandalone()).current;

  useEffect(() => onInstallChange(() => setPromptable(canPrompt())), []);

  useEffect(() => {
    pages.current.add(pathname);
    if (pages.current.size >= PAGES_BEFORE) setEngaged(true);
  }, [pathname]);

  useEffect(() => {
    const timer = window.setTimeout(() => setEngaged(true), SECONDS_BEFORE * 1000);
    return () => window.clearTimeout(timer);
  }, []);

  if (standalone || closed || !engaged || QUIET_PATHS.test(pathname) || !(promptable || ios)) return null;

  const close = () => {
    snoozeBanner();
    setClosed(true);
  };
  const install = async () => {
    const accepted = await promptInstall();
    if (accepted) markInstalled();
    else snoozeBanner();
    setClosed(true);
  };

  return (
    <div role="dialog" aria-label={tr('نزّل عربيتي على موبايلك', 'Install 3arabity')} className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md md:bottom-4">
      <div className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-xl ring-1 ring-line">
        <img src="/icon-72.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-navy">{tr('حط عربيتي على شاشة موبايلك', 'Add 3arabity to your home screen')}</p>
          {ios ? (
            <p className="mt-1 text-sm leading-6 text-ink-soft">
              {tr('دوس على', 'Tap')} <Share className="inline h-4 w-4 align-[-3px] text-navy" aria-label={tr('مشاركة', 'Share')} /> {tr('تحت، وبعدين', 'below, then')}{' '}
              <span className="whitespace-nowrap font-bold text-ink">
                <SquarePlus className="inline h-4 w-4 align-[-3px]" /> {tr('إضافة إلى الشاشة الرئيسية', 'Add to Home Screen')}
              </span>
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm leading-6 text-ink-soft">{tr('يفتح أسرع زي التطبيق، ومن غير ما تدوّر عليه.', 'Opens faster, like an app, right from your home screen.')}</p>
              <Button size="sm" variant="accent" className="mt-3" onClick={install}>
                <Download className="h-4 w-4" />
                {tr('نزّله', 'Install')}
              </Button>
            </>
          )}
        </div>
        <button onClick={close} className="-m-1 rounded-lg p-1.5 text-ink-muted hover:bg-canvas hover:text-ink" aria-label={tr('اقفل', 'Close')}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
