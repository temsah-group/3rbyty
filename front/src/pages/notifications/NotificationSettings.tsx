import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Mail } from 'lucide-react';
import { useState } from 'react';

import { PageShell } from '@/components/Layout';
import { cx, ErrorState, errorMessage, PageSpinner, useToast } from '@/components/ui';
import { get, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { disablePush, enablePush, pushState, pushToken } from '@/lib/push';
import type { NotificationSettings as Settings } from '@/lib/types';
import { usePageMeta } from '@/lib/seo';

export default function NotificationSettings() {
  const { tr } = useI18n();
  const { user } = useAuth();
  usePageMeta(tr('إعدادات الإشعارات', 'Notification settings'));
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['me', 'notification-settings'], queryFn: () => get<Settings>('/notifications/settings') });

  const toggle = async (key: keyof Settings) => {
    if (!settings.data) return;
    const next = { ...settings.data, [key]: !settings.data[key] };
    queryClient.setQueryData(['me', 'notification-settings'], next);
    try {
      await put('/notifications/settings', next);
    } catch (error) {
      queryClient.setQueryData(['me', 'notification-settings'], settings.data);
      toast(errorMessage(error, tr('محصلش حفظ', "Couldn't save")));
    }
  };

  const rows: { key: Exclude<keyof Settings, 'email'>; title: string; body: string }[] = [
    { key: 'fitsMyCar', title: tr('قطع جديدة لعربيتي', 'New parts for my cars'), body: tr('لما حد يعرض قطعة بتركب على عربية من عربياتك.', 'When someone lists a part that fits one of your cars.') },
    { key: 'priceDrops', title: tr('سعر نزل', 'Price drops'), body: tr('لما سعر قطعة في محفوظاتك يقل.', 'When a saved part gets cheaper.') },
    { key: 'news', title: tr('أخبار عربيتي', '3arabity news'), body: tr('عروض وأخبار من فريق عربيتي.', 'Offers and news from the 3arabity team.') },
  ];

  return (
    <PageShell title={tr('إعدادات الإشعارات', 'Notification settings')}>
      <BrowserPush />
      {settings.isLoading ? (
        <PageSpinner />
      ) : settings.isError || !settings.data ? (
        <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <>
        <div className="mb-4 overflow-hidden rounded-2xl bg-white ring-1 ring-line">
          <button role="switch" aria-checked={settings.data.email} onClick={() => toggle('email')} className="flex w-full items-center gap-4 p-5 text-start hover:bg-canvas">
            <Mail className="h-6 w-6 shrink-0 text-navy" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{tr('إشعارات على الإيميل', 'Email notifications')}</span>
              <span className="block text-sm text-ink-soft">
                {tr('ردود المحلات والحاجات المهمة توصلك علطول، والباقي في إيميل واحد كل يوم', "Shops' answers and important news right away, the rest in one email a day")}
                {user?.email && <span className="block truncate" dir="ltr">{user.email}</span>}
              </span>
            </span>
            <Switch on={settings.data.email} />
          </button>
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white ring-1 ring-line">
          {rows.map((r) => {
            const on = settings.data[r.key];
            return (
              <li key={r.key}>
                <button role="switch" aria-checked={on} onClick={() => toggle(r.key)} className="flex w-full items-center gap-4 p-5 text-start hover:bg-canvas">
                  <span className="flex-1">
                    <span className="block font-bold">{r.title}</span>
                    <span className="block text-sm text-ink-soft">{r.body}</span>
                  </span>
                  <Switch on={on} />
                </button>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </PageShell>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-orange' : 'bg-line')}>
      <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'end-1' : 'end-6')} />
    </span>
  );
}

/** This browser's push switch; hidden when the browser or the site can't push. */
function BrowserPush() {
  const { tr } = useI18n();
  const toast = useToast();
  const token = pushToken.use();
  const [busy, setBusy] = useState(false);
  const state = pushState(token);
  if (state === 'unsupported') return null;

  const toggle = async () => {
    if (busy || state === 'denied') return;
    setBusy(true);
    try {
      if (state === 'on') {
        await disablePush();
        toast(tr('وقفنا الإشعارات على المتصفح ده', 'Browser notifications are off'));
      } else if (await enablePush()) {
        toast(tr('هتوصلك الإشعارات على المتصفح ده', 'Browser notifications are on'));
      } else {
        toast(tr('محتاجين إذنك عشان نبعتلك إشعارات', 'We need your permission to notify you'));
      }
    } catch (error) {
      toast(errorMessage(error, tr('محصلش تفعيل، حاول تاني', "Couldn't turn it on, try again")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 overflow-hidden rounded-2xl bg-white ring-1 ring-line">
      <button role="switch" aria-checked={state === 'on'} aria-busy={busy} disabled={state === 'denied'} onClick={toggle} className="flex w-full items-center gap-4 p-5 text-start hover:bg-canvas disabled:cursor-not-allowed disabled:hover:bg-white">
        <BellRing className="h-6 w-6 shrink-0 text-navy" />
        <span className="flex-1">
          <span className="block font-bold">{tr('إشعارات المتصفح', 'Browser notifications')}</span>
          <span className="block text-sm text-ink-soft">
            {state === 'denied'
              ? tr('المتصفح مانع الإشعارات للموقع ده. اسمح بيها من إعدادات الموقع (علامة القفل جنب العنوان) وارجع هنا.', 'Your browser blocks notifications for this site. Allow them in the site settings (the lock next to the address) and come back.')
              : tr('توصلك الإشعارات على الجهاز ده حتى لو الموقع مقفول.', 'Get notified on this device even when the site is closed.')}
          </span>
        </span>
        <Switch on={state === 'on'} />
      </button>
    </div>
  );
}
