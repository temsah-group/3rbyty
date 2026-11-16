import { BellRing, CheckCircle2, Download, EllipsisVertical, Share, Smartphone, SquarePlus, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { PageShell } from '@/components/Layout';
import { Button, cx } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { canPrompt, isIosSafari, isStandalone, markInstalled, onInstallChange, promptInstall } from '@/lib/install';
import { usePageMeta } from '@/lib/seo';

type Platform = 'android' | 'iphone';

const isIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

/**
 * "Install the app": always reachable from the footer and the account menu,
 * unlike the banner, which only asks once in a while. One button where the
 * browser can install by itself, and the taps for each phone otherwise.
 */
export default function InstallApp() {
  const { tr } = useI18n();
  usePageMeta(tr('نزّل تطبيق عربيتي', 'Get the 3arabity app'), tr('حط عربيتي على شاشة موبايلك: يفتح أسرع زي التطبيق، من غير متجر ومن غير مساحة.', 'Put 3arabity on your home screen: opens fast like an app, no store, no storage.'));
  const [promptable, setPromptable] = useState(canPrompt);
  const [installed, setInstalled] = useState(isStandalone);
  const [platform, setPlatform] = useState<Platform>(() => (isIphone() ? 'iphone' : 'android'));
  useEffect(() => onInstallChange(() => setPromptable(canPrompt())), []);

  const install = async () => {
    if (await promptInstall()) {
      markInstalled();
      setInstalled(true);
    }
  };

  return (
    <PageShell title={tr('نزّل تطبيق عربيتي', 'Get the 3arabity app')}>
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center gap-4 rounded-2xl bg-navy p-5 text-white">
          <img src="/icon-112.png" alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-2xl" />
          <div>
            <p className="text-lg font-extrabold">{tr('عربيتي على شاشة موبايلك', '3arabity on your home screen')}</p>
            <p className="mt-1 text-sm leading-6 text-white/75">{tr('من غير متجر ومن غير ما ياخد مساحة. بيتحدّث لوحده.', 'No app store, barely any storage. Always up to date.')}</p>
          </div>
        </div>

        {installed ? (
          <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 font-bold text-emerald-800 ring-1 ring-emerald-200">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            {tr('انت فاتح عربيتي كتطبيق دلوقتي.', "You're using 3arabity as an app right now.")}
          </p>
        ) : promptable ? (
          <Button variant="accent" className="h-12 w-full text-base" onClick={install}>
            <Download className="h-5 w-5" />
            {tr('نزّل التطبيق', 'Install the app')}
          </Button>
        ) : null}

        <ul className="grid grid-cols-3 gap-2 sm:gap-3">
          <Perk icon={<Zap className="h-5 w-5" />} text={tr('يفتح أسرع من المتصفح', 'Opens faster than the browser')} />
          <Perk icon={<Smartphone className="h-5 w-5" />} text={tr('شاشة كاملة زي أي تطبيق', 'Full screen like any app')} />
          <Perk icon={<BellRing className="h-5 w-5" />} text={tr('إشعارات الردود والأسعار', 'Alerts for replies and prices')} />
        </ul>

        {!installed && (
          <section className="rounded-2xl bg-white p-5 ring-1 ring-line">
            <h2 className="mb-4 font-extrabold text-navy">{promptable ? tr('أو بنفسك من المتصفح', 'Or from the browser menu') : tr('إزاي تنزّله', 'How to install')}</h2>
            <div className="mb-5 flex gap-2 rounded-xl bg-canvas p-1">
              {(['android', 'iphone'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  aria-pressed={platform === p}
                  className={cx('flex-1 rounded-lg py-2 text-sm font-bold', platform === p ? 'bg-white text-navy shadow-sm' : 'text-ink-soft')}
                >
                  {p === 'android' ? tr('أندرويد', 'Android') : tr('آيفون', 'iPhone')}
                </button>
              ))}
            </div>
            {platform === 'android' ? (
              <ol className="space-y-4">
                <Step n={1}>{tr('افتح 3rbyty.com من Chrome.', 'Open 3rbyty.com in Chrome.')}</Step>
                <Step n={2}>
                  {tr('دوس على', 'Tap')} <Glyph><EllipsisVertical className="h-4 w-4" /></Glyph> {tr('فوق.', 'at the top.')}
                </Step>
                <Step n={3}>
                  {tr('اختار', 'Choose')} <b>{tr('"تثبيت التطبيق"', '"Install app"')}</b> {tr('أو', 'or')} <b>{tr('"إضافة إلى الشاشة الرئيسية"', '"Add to Home screen"')}</b>.
                </Step>
                <Step n={4}>{tr('دوس "تثبيت"، وأيقونة عربيتي هتظهر مع تطبيقاتك.', 'Tap "Install" and the 3arabity icon shows with your apps.')}</Step>
              </ol>
            ) : (
              <ol className="space-y-4">
                <Step n={1}>
                  {tr('افتح 3rbyty.com من', 'Open 3rbyty.com in')} <b>Safari</b>{' '}
                  {!isIosSafari() && isIphone() && <span className="text-ink-soft">{tr('(لازم Safari، Chrome على الآيفون مش بينزّل مواقع)', "(Safari only: Chrome on iPhone can't install sites)")}</span>}
                </Step>
                <Step n={2}>
                  {tr('دوس على زرار المشاركة', 'Tap the Share button')} <Glyph><Share className="h-4 w-4" /></Glyph> {tr('تحت.', 'at the bottom.')}
                </Step>
                <Step n={3}>
                  {tr('انزل واختار', 'Scroll and choose')} <Glyph><SquarePlus className="h-4 w-4" /></Glyph> <b>{tr('"إضافة إلى الشاشة الرئيسية"', '"Add to Home Screen"')}</b>.
                </Step>
                <Step n={4}>{tr('دوس "إضافة" فوق، وخلاص.', 'Tap "Add" at the top. Done.')}</Step>
              </ol>
            )}
          </section>
        )}
      </div>
    </PageShell>
  );
}

function Perk({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <li className="flex flex-col items-center gap-2 rounded-2xl bg-white p-3 text-center text-xs font-bold leading-5 ring-1 ring-line sm:text-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-mist text-orange-deep">{icon}</span>
      {text}
    </li>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3 leading-7">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-extrabold text-white">{n}</span>
      <span>{children}</span>
    </li>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return <span className="mx-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-canvas align-middle text-navy ring-1 ring-line">{children}</span>;
}
