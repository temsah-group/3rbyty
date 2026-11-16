import type { ReactNode } from 'react';

import { useI18n } from '@/lib/i18n';

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { tr } = useI18n();
  return (
    <div className="mx-auto grid max-w-5xl gap-0 px-4 py-8 md:grid-cols-2 md:py-14">
      <div className="relative hidden min-h-[560px] flex-col overflow-hidden rounded-s-3xl bg-navy p-10 text-white md:flex">
        {/* public/auth.webp (scripts/optimize-assets.mjs); if it fails the panel is plain navy. */}
        <img
          src="/auth.webp"
          loading="lazy"
          decoding="async"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty('display', 'none');
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-navy/10 via-transparent via-40% to-navy to-85%" aria-hidden />
        <img src="/icon-112.png" alt="" width={56} height={56} className="relative h-14 w-14 rounded-2xl" />
        <div className="relative mt-auto">
          <p className="text-3xl font-extrabold leading-snug">{tr('كل قطع غيار عربيتك في مكان واحد.', 'Every part for your car, in one place.')}</p>
          <p className="mt-3 text-white/80">{tr('احفظ القطع، تابع عربياتك، واعرض اللي عندك للبيع.', 'Save parts, follow your cars and sell what you have.')}</p>
          <ul className="mt-6 flex flex-wrap gap-2 text-sm font-bold">
            {[tr('جديد ومستعمل ومستورد', 'New, used and imported'), tr('محلات موثّقة', 'Verified shops'), tr('تواصل مباشر مع البياع', 'Talk to the seller directly')].map((t) => (
              <li key={t} className="rounded-full bg-white/15 px-3 py-1.5 backdrop-blur-sm">{t}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="rounded-3xl bg-white p-6 ring-1 ring-line md:rounded-s-none md:p-10">
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export const fieldErr = (error: unknown, field: string) =>
  (error as { fieldError?: (f: string) => string | undefined } | null)?.fieldError?.(field);
