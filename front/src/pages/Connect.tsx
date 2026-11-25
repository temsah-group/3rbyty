import { ArrowLeft, MapPin, MessageCircle, PlayCircle, Search, Smartphone, Store } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { SocialIcon } from '@/components/Layout';
import { useAppConfig } from '@/lib/catalog';
import { whatsappLink } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { usePageMeta } from '@/lib/seo';
import { CONTACT_PHONE, SOCIAL } from '@/lib/social';

/**
 * Where the QR on our cards and flyers leads: who we are, the three ways in
 * (browse, sell, WhatsApp), the app and our pages. On its own, without the
 * site's header and footer.
 */
export default function Connect() {
  const { tr } = useI18n();
  usePageMeta(tr('عربيتي: سوق قطع الغيار في مصر', '3arabity: Egypt’s car parts market'), tr('قطعة عربيتك أقرب وأسهل: جديد ومستعمل واستيراد. تصفح قطع الغيار، اعرض قطعك، أو كلمنا على واتساب.', 'Your car’s part, closer and easier: new, used and imported.'));
  const whatsapp = useAppConfig().data?.support?.whatsapp || CONTACT_PHONE;

  return (
    <div className="relative min-h-screen overflow-hidden bg-navy-deep text-white">
      {/* Warm light behind the logo, like the cards. */}
      <div aria-hidden className="pointer-events-none absolute -top-44 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-orange/20 blur-3xl" />

      <main className="relative mx-auto flex min-h-screen max-w-md flex-col px-6 pb-8 pt-12">
        <header className="flex flex-col items-center text-center">
          <img src="/icon-192.png" alt="" width={96} height={96} className="rounded-3xl shadow-lg shadow-orange/25 ring-1 ring-white/10" style={{ width: 96, height: 96 }} />
          <h1 className="mt-5 text-4xl font-extrabold">{tr('عربيتي', '3arabity')}</h1>
          <p className="mt-1 font-bold text-orange">{tr('سوق قطع الغيار في مصر', 'Egypt’s car parts market')}</p>
          <p className="mt-2 text-sm text-white/75">{tr('جديد • مستعمل • استيراد', 'New • Used • Imported')}</p>
          <p className="mt-1 font-bold">{tr('قطعة عربيتك أقرب وأسهل.', 'Your car’s part, closer and easier.')}</p>
        </header>

        <nav className="mt-8 space-y-3">
          <Link to="/search" className="flex items-center gap-3 rounded-2xl bg-orange p-4 text-navy-deep shadow-lg shadow-orange/25 transition hover:bg-orange-light active:scale-[0.99]">
            <Search className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1 text-center">
              <span className="block text-lg font-extrabold">{tr('تصفح قطع الغيار', 'Browse parts')}</span>
              <span className="block text-xs font-semibold opacity-80">{tr('دوّر على القطعة اللي محتاجها', 'Find the part you need')}</span>
            </span>
            <ArrowLeft className="h-5 w-5 shrink-0 ltr:rotate-180" />
          </Link>

          <Link to="/register" className="flex items-center gap-3 rounded-2xl p-4 ring-1 ring-white/25 transition hover:bg-white/5 active:scale-[0.99]">
            <Store className="h-6 w-6 shrink-0 text-orange" />
            <span className="min-w-0 flex-1 text-center">
              <span className="block text-lg font-extrabold">{tr('سجل كبائع أو صاحب محل', 'Join as a seller or a shop')}</span>
              <span className="block text-xs text-white/65">{tr('اعرض قطع الغيار بتاعتك', 'List your parts')}</span>
            </span>
            <ArrowLeft className="h-5 w-5 shrink-0 opacity-60 ltr:rotate-180" />
          </Link>

          <a href={whatsappLink(whatsapp, tr('السلام عليكم، جاي من عربيتي', 'Hi, I came from 3arabity'))} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl bg-[#25D366]/15 p-4 text-[#4ADE80] ring-1 ring-[#25D366]/30 transition hover:bg-[#25D366]/25 active:scale-[0.99]">
            <MessageCircle className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1 text-center text-lg font-extrabold">{tr('تواصل معانا على واتساب', 'Message us on WhatsApp')}</span>
            <span className="w-6 shrink-0" />
          </a>
        </nav>

        <section className="mt-6 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <h2 className="text-center text-lg font-extrabold">{tr('تطبيق عربيتي', 'The 3arabity app')}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Store3 icon={<Smartphone />} name="App Store" />
            <Store3 icon={<PlayCircle />} name="Google Play" />
          </div>
          <Link to="/app" className="mt-3 block text-center text-sm font-bold text-orange hover:underline">
            {tr('أو نزّله على موبايلك دلوقتي ←', 'Or put it on your phone now →')}
          </Link>
        </section>

        <section className="mt-6 border-t border-white/10 pt-6 text-center">
          <p className="font-bold text-white/85">{tr('تابعنا على السوشيال ميديا', 'Follow us')}</p>
          <div className="mt-4 flex justify-center gap-8">
            {SOCIAL.map((s) => (
              <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="group flex flex-col items-center gap-2">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/10 transition group-hover:bg-orange group-hover:text-navy-deep">
                  <SocialIcon id={s.id} className="h-6 w-6" />
                </span>
                <span className="text-sm text-white/75">{s.label}</span>
              </a>
            ))}
          </div>
        </section>

        <footer className="mt-auto pt-8 text-center text-sm">
          <p className="flex items-center justify-center gap-1 text-white/70">
            <MapPin className="h-4 w-4" />
            {tr('جميع محافظات مصر', 'All over Egypt')}
          </p>
          <Link to="/" className="mt-1 inline-block font-bold text-orange hover:underline" dir="ltr">3rbyty.com</Link>
        </footer>
      </main>
    </div>
  );
}

/** A store the app is coming to. */
function Store3({ icon, name }: { icon: ReactNode; name: string }) {
  const { tr } = useI18n();
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-navy-deep px-3 py-3 ring-1 ring-white/10 [&>svg]:h-5 [&>svg]:w-5 [&>svg]:text-white/80">
      {icon}
      <span className="text-sm font-bold" dir="ltr">{name}</span>
      <span className="text-xs text-white/55">{tr('قريباً', 'Soon')}</span>
    </div>
  );
}
