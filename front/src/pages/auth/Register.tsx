import { Camera, Loader2, Store, User } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { GoogleSignIn } from '@/components/GoogleSignIn';
import { Button, cx, Field, TextField } from '@/components/ui';
import { PickSelect } from '@/components/PickSelect';
import { ApiError, post, upload } from '@/lib/api';
import { toE164 } from '@/lib/format';
import { readCardLocally } from '@/lib/card-ocr';
import { findPhone, type CardDetails } from '@/lib/card-parse';
import { rememberPassword } from '@/lib/auth';
import { governorateOptions, GOVERNORATES, useAppConfig, useLabels } from '@/lib/catalog';
import { useI18n } from '@/lib/i18n';
import { usePageMeta } from '@/lib/seo';

import { AuthShell, fieldErr } from './AuthShell';

/**
 * A phone photo can be several megabytes; a card reads fine at 1600px, so it
 * is shrunk to a JPEG of that size before it is sent.
 */
async function shrinkPhoto(file: File, maxSide = 1600): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'card.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    // A browser that can't decode it here: send it as it is.
    return file;
  }
}

export default function Register() {
  const { tr } = useI18n();
  const labels = useLabels();
  usePageMeta(tr('اعمل حساب', 'Create an account'));
  const navigate = useNavigate();
  const back = (useLocation().state as { from?: string } | null)?.from ?? '/';
  // Signing up as a shop opens it once the email is confirmed (pending
  // review), so the owner lands on their shop, not on a form to make one.
  const [kind, setKind] = useState<'person' | 'shop'>('person');
  const isShop = kind === 'shop';
  const from = isShop ? '/account/shop' : back;
  const [form, setForm] = useState({ fullName: '', shopName: '', city: '', address: '', email: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [phoneError, setPhoneError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const cardScan = useAppConfig().data?.features?.cardScan ?? false;
  const cardInput = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  /** 0–1 while the free in-browser reader loads and reads; null otherwise. */
  const [scanProgress, setScanProgress] = useState<number | null>(null);
  const [scanNote, setScanNote] = useState<{ ok: boolean; text: string } | null>(null);

  /**
   * Fills the shop's details from a photo of its business card; the owner
   * checks them before signing up. Claude on the server reads it when the
   * server has a key; otherwise, or if that fails, a free reader in the browser.
   */
  const scanCard = async (file: File | undefined) => {
    if (!file) return;
    setScanning(true);
    setScanNote(null);
    try {
      let card: CardDetails | null = null;
      if (cardScan) {
        card = await upload<CardDetails>('/auth/scan-card', await shrinkPhoto(file)).catch(() => null);
      }
      if (!card) {
        setScanProgress(0);
        card = await readCardLocally(file, setScanProgress);
      }
      const phone = card.phone ? findPhone(card.phone) : null;
      const city = card.city && GOVERNORATES.includes(card.city) ? card.city : null;
      setForm((f) => ({
        ...f,
        shopName: card.shopName ?? f.shopName,
        phone: phone ?? f.phone,
        city: city ?? f.city,
        address: card.address ?? f.address,
      }));
      const found = [card.shopName, phone, city, card.address].filter(Boolean).length;
      setScanNote(
        found
          ? { ok: true, text: tr('قرينا الكارت وملينا البيانات. راجعها وعدّل اللي محتاج.', 'We read the card and filled in the details. Check them and fix anything.') }
          : { ok: false, text: tr('معرفناش نقرا حاجة من الكارت، جرّب صورة أوضح أو اكتب البيانات بإيدك.', "We couldn't read anything from the card. Try a clearer photo or type the details.") },
      );
    } catch (err) {
      setScanNote({ ok: false, text: err instanceof ApiError ? err.message : tr('معرفناش نقرا الكارت، حاول تاني.', "We couldn't read the card, try again.") });
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  };

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const phone = toE164(form.phone);
    setPhoneError(phone ? undefined : tr('اكتب رقم موبايل مصري صحيح، زي 01012345678', 'Enter an Egyptian mobile number, like 01012345678'));
    if (!phone) return;
    setLoading(true);
    setError(null);
    try {
      const shopName = form.shopName.trim();
      await post('/auth/register', {
        // A shop's account goes by the shop's name until the owner adds theirs.
        fullName: isShop ? shopName : form.fullName.trim(),
        identifier: form.email.trim(),
        phone,
        password: form.password,
        confirmPassword: form.confirm,
        ...(isShop && { shop: { name: shopName, city: form.city, address: form.address.trim() } }),
      });
      rememberPassword(form.password);
      navigate('/verify', { state: { email: form.email.trim(), purpose: 'register', from } });
    } catch (err) {
      setError(err instanceof ApiError ? err : null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={tr('اعمل حساب', 'Create an account')} subtitle={tr('هنبعتلك كود على الإيميل تأكد بيه.', "We'll email you a code to confirm it.")}>
      <div role="radiogroup" aria-label={tr('نوع الحساب', 'Account type')} className="mb-5 grid grid-cols-2 gap-3">
        {([
          { id: 'person', icon: User, title: tr('فرد', 'Individual'), hint: tr('بشتري أو ببيع قطعة', 'Buy or sell a part') },
          { id: 'shop', icon: Store, title: tr('محل', 'Shop'), hint: tr('عندي محل قطع غيار', 'I own a parts shop') },
        ] as const).map((option) => {
          const on = kind === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setKind(option.id)}
              className={cx(
                'flex flex-col items-center gap-1 rounded-2xl border-2 p-4 text-center transition',
                on ? 'border-orange bg-orange-mist' : 'border-line hover:border-ink-soft/40',
              )}
            >
              <option.icon className={cx('h-6 w-6', on ? 'text-orange-deep' : 'text-ink-soft')} />
              <span className="font-bold">{option.title}</span>
              <span className="text-xs text-ink-soft">{option.hint}</span>
            </button>
          );
        })}
      </div>
      {isShop && (
        <p className="mb-4 rounded-xl bg-orange-mist p-3 text-sm leading-6 text-ink-soft">
          {tr(
            'محلك هيتفتح أول ما تأكد الإيميل، وهيظهر للناس بعد ما نراجعه.',
            'Your shop opens as soon as you confirm your email, and shows to buyers once we review it.',
          )}
        </p>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        {isShop ? (
          <>
              <div className="rounded-2xl border-2 border-dashed border-orange/40 bg-orange-mist p-4 text-center">
                <button
                  type="button"
                  onClick={() => cardInput.current?.click()}
                  disabled={scanning}
                  className="inline-flex items-center gap-2 rounded-xl bg-orange px-4 py-2.5 font-bold text-white hover:bg-orange-deep disabled:opacity-70"
                >
                  {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                  {scanning
                    ? scanProgress !== null
                      ? `${tr('بنقرا الكارت…', 'Reading the card…')} ${Math.round(scanProgress * 100)}%`
                      : tr('بنقرا الكارت…', 'Reading the card…')
                    : tr('صوّر كارت المحل', 'Snap your business card')}
                </button>
                <p className="mt-2 text-xs text-ink-soft">{tr('هنملا الاسم والرقم والعنوان من الكارت لوحدنا.', "We'll fill in the name, number and address from it.")}</p>
                {/* `capture` opens the back camera on phones; a computer picks a file. */}
                <input ref={cardInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => { void scanCard(e.target.files?.[0]); e.target.value = ''; }} />
                {scanNote && (
                  <p role="status" className={cx('mt-3 rounded-lg p-2 text-sm', scanNote.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>
                    {scanNote.text}
                  </p>
                )}
              </div>
            <TextField label={tr('اسم المحل', 'Shop name')} placeholder={tr('مثلاً: الأمانة لقطع الغيار', 'e.g. Al Amana Spare Parts')} value={form.shopName} onChange={set('shopName')} maxLength={60} error={fieldErr(error, 'shop.name') ?? fieldErr(error, 'fullName')} />
            <Field label={tr('المحافظة', 'Governorate')} error={fieldErr(error, 'shop.city')}>
              <PickSelect options={governorateOptions(labels.city)} value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} placeholder={tr('اختار', 'Choose')} ariaLabel={tr('المحافظة', 'Governorate')} searchLabel={tr('دوّر على المحافظة…', 'Find a governorate…')} invalid={Boolean(fieldErr(error, 'shop.city'))} />
            </Field>
            <TextField label={tr('عنوان المحل', 'Shop address')} placeholder={tr('الشارع والمنطقة', 'Street and area')} value={form.address} onChange={set('address')} maxLength={200} error={fieldErr(error, 'shop.address')} />
          </>
        ) : (
          <TextField label={tr('الاسم بالكامل', 'Full name')} autoComplete="name" value={form.fullName} onChange={set('fullName')} error={fieldErr(error, 'fullName')} />
        )}
        <TextField label={tr('الإيميل', 'Email')} type="email" autoComplete="email" dir="ltr" value={form.email} onChange={set('email')} error={fieldErr(error, 'identifier')} />
        <TextField label={isShop ? tr('موبايل المحل', 'Shop mobile') : tr('رقم الموبايل', 'Mobile number')} hint={isShop ? tr('المشترين هيكلموك عليه أو على واتساب.', 'Buyers call or WhatsApp you on it.') : undefined} type="tel" autoComplete="tel" dir="ltr" placeholder="01012345678" value={form.phone} onChange={set('phone')} error={phoneError ?? fieldErr(error, 'phone')} />
        <TextField label={tr('كلمة السر', 'Password')} type="password" autoComplete="new-password" dir="ltr" value={form.password} onChange={set('password')} error={fieldErr(error, 'password')} hint={tr('8 حروف على الأقل', 'At least 8 characters')} />
        <TextField label={tr('أكد كلمة السر', 'Confirm password')} type="password" autoComplete="new-password" dir="ltr" value={form.confirm} onChange={set('confirm')} error={fieldErr(error, 'confirmPassword')} />
        {error && !error.errors.length && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
        <p className="text-xs leading-6 text-ink-soft">
          {tr('بإنك تعمل حساب إنت موافق على ', 'By creating an account you agree to the ')}
          <Link to="/legal/terms" className="underline">{tr('شروط الاستخدام', 'terms of use')}</Link>
          {tr(' و', ' and ')}
          <Link to="/legal/privacy" className="underline">{tr('سياسة الخصوصية', 'privacy policy')}</Link>.
        </p>
        <Button type="submit" className="w-full" loading={loading}>{tr('اعمل الحساب', 'Create account')}</Button>
      </form>
      {/* Google gives no shop details, so a shop signs up with the form. */}
      {!isShop && <GoogleSignIn from={from} />}
      <p className="mt-6 text-center text-sm text-ink-soft">
        {tr('عندك حساب؟ ', 'Have an account? ')}
        <Link to="/login" className="font-bold text-orange-deep hover:underline">{tr('ادخل', 'Sign in')}</Link>
      </p>
    </AuthShell>
  );
}
