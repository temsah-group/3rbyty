import { useQueryClient } from '@tanstack/react-query';
import { Plus, Send } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { CarPicker } from '@/components/cars';
import { PickSelect } from '@/components/PickSelect';
import { Button, cx, Field, Textarea, TextField, useToast } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { carId, CATEGORIES, governorateOptions, useLabels } from '@/lib/catalog';
import { garage } from '@/lib/collections';
import { useI18n } from '@/lib/i18n';
import { usePageMeta } from '@/lib/seo';
import type { Category, GarageCar, PartRequest } from '@/lib/types';

/**
 * "Ask for a part": the part, the car, the governorate. The shops that carry
 * that make there are told and answer with a price.
 */
export default function NewRequest() {
  const { tr, lang } = useI18n();
  usePageMeta(tr('اطلب قطعة', 'Ask for a part'), null, { noindex: true });
  const labels = useLabels();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { cars } = garage.use();
  const [params] = useSearchParams();
  const [partName, setPartName] = useState(params.get('q') ?? '');
  const [category, setCategory] = useState<Category | null>((params.get('category') as Category | null) ?? null);
  const [car, setCar] = useState<GarageCar | null>(cars[0] ?? null);
  const [picking, setPicking] = useState(false);
  // Empty: anywhere in Egypt, so every shop for the car hears of it.
  const [city, setCity] = useState('');
  const [onePlace, setOnePlace] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  // The car picked here, when it is not one of the garage's.
  const choices = car && !cars.some((c) => carId(c) === carId(car)) ? [car, ...cars] : cars;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (partName.trim().length < 3) found.partName = tr('اكتب اسم القطعة (3 حروف على الأقل)', 'Write the part (3 letters or more)');
    if (!car) found.car = tr('اختار العربية', 'Choose the car');
    if (onePlace && !city) found.city = tr('اختار المحافظة، أو خليها كل مصر', 'Choose the governorate, or keep all of Egypt');
    setErrors(found);
    if (Object.keys(found).length || !car) return;
    setSending(true);
    try {
      const request = await post<PartRequest>('/requests', {
        partName: partName.trim(),
        category,
        car: { brandId: car.brandId, brandName: car.brandName ?? null, modelId: car.modelId, modelName: car.modelName ?? null, year: car.year },
        city: onePlace && city ? city : null,
        note: note.trim() || null,
      });
      queryClient.invalidateQueries({ queryKey: ['requests', 'mine'] });
      toast(tr('اتبعت طلبك للمحلات، هيوصلك إشعار لما حد يرد', "Sent to the shops. You'll be notified when one answers"));
      navigate(`/requests/${request.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(Object.fromEntries(err.errors.map((x) => [x.field.split('.')[0], x.message])));
      toast(err instanceof ApiError ? err.message : tr('محصلش، حاول تاني', "Didn't work, try again"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
      <h1 className="text-2xl font-extrabold md:text-3xl">{tr('اطلب قطعة', 'Ask for a part')}</h1>
      <p className="mt-2 text-ink-soft">
        {tr('قولنا القطعة اللي محتاجها، وهنبعتها للمحلات اللي بتشتغل على عربيتك، وهما يردوا عليك بأسعارهم.', "Tell us the part you need. We'll send it to the shops that work on your car, and they answer with their prices.")}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-5 rounded-2xl bg-white p-5 ring-1 ring-line md:p-6" noValidate>
        <TextField label={tr('القطعة', 'The part')} placeholder={tr('مثلاً: طقم تيل فرامل أمامي', 'e.g. Front brake pads')} value={partName} onChange={(e) => setPartName(e.target.value)} error={errors.partName} maxLength={100} />
        <Field label={tr('العربية', 'The car')} error={errors.car}>
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => {
              const on = car !== null && carId(c) === carId(car);
              return (
                <button key={carId(c)} type="button" aria-pressed={on} onClick={() => setCar(c)} className={cx('rounded-xl px-3 py-2 text-sm font-bold ring-1', on ? 'bg-navy text-white ring-navy' : 'bg-white ring-line hover:ring-navy')}>
                  {labels.car(c)}
                </button>
              );
            })}
            <button type="button" onClick={() => setPicking(true)} className="flex items-center gap-1 rounded-xl border border-dashed border-line px-3 py-2 text-sm font-bold text-orange-deep hover:border-navy">
              <Plus className="h-4 w-4" />
              {cars.length ? tr('عربية تانية', 'Another car') : tr('اختار العربية', 'Choose the car')}
            </button>
          </div>
        </Field>
        <Field label={tr('القسم (اختياري)', 'Category (optional)')}>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? null : c.id)} className={cx('rounded-xl px-3 py-2 text-sm font-bold ring-1', category === c.id ? 'bg-navy text-white ring-navy' : 'bg-white ring-line hover:ring-navy')}>
                {lang === 'ar' ? c.ar : c.en}
              </button>
            ))}
          </div>
        </Field>
        <Field
          label={tr('نبعت لمحلات فين؟', 'Which shops should hear of it?')}
          hint={onePlace ? tr('هيوصل للمحلات اللي في المحافظة دي أو بتوصّل لها بس.', 'Only shops in that governorate, or that deliver there.') : tr('هيوصل لكل المحلات في مصر اللي بتشتغل على عربيتك، فردود أكتر.', 'Every shop in Egypt that works on your car, so more answers.')}
          error={errors.city}
        >
          <div className="flex flex-wrap gap-2">
            {[
              { one: false, label: tr('كل مصر', 'All of Egypt') },
              { one: true, label: tr('محافظة معينة', 'One governorate') },
            ].map((choice) => (
              <button key={String(choice.one)} type="button" aria-pressed={onePlace === choice.one} onClick={() => setOnePlace(choice.one)} className={cx('rounded-xl px-3 py-2 text-sm font-bold ring-1', onePlace === choice.one ? 'bg-navy text-white ring-navy' : 'bg-white ring-line hover:ring-navy')}>
                {choice.label}
              </button>
            ))}
          </div>
          {onePlace && (
            <div className="mt-2">
              <PickSelect options={governorateOptions(labels.city)} value={city} onChange={setCity} placeholder={tr('اختار', 'Choose')} ariaLabel={tr('المحافظة', 'Governorate')} searchLabel={tr('دوّر بالمحافظة أو المدينة…', 'Find a governorate or city…')} invalid={Boolean(errors.city)} />
            </div>
          )}
        </Field>
        <Field label={tr('تفاصيل زيادة (اختياري)', 'More details (optional)')} hint={`${note.length}/300`}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={tr('رقم القطعة، أصلي ولا تجاري، محتاجها إمتى…', 'Part number, original or aftermarket, when you need it…')} />
        </Field>
        <Button type="submit" variant="accent" className="w-full" loading={sending}>
          <Send className="h-4 w-4" />
          {tr('ابعت الطلب للمحلات', 'Send to the shops')}
        </Button>
        <p className="text-center text-xs text-ink-soft">{tr('رقمك مش بيظهر للمحلات، انت اللي بتكلمهم لما يردوا.', 'Shops never see your number; you contact them when they answer.')}</p>
      </form>
      <CarPicker open={picking} onClose={() => setPicking(false)} onPick={(c) => setCar(c)} title={tr('القطعة لأنهي عربية؟', 'Which car is it for?')} />
    </div>
  );
}
