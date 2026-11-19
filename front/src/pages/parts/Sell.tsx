import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, ImagePlus, Loader2, Plus, Star, Store, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { BrandSelect, withOtherBrand, YearField, yearOk } from '@/components/cars';
import { Button, cx, Dialog, ErrorState, Field, Img, Input, PageSpinner, Select, Textarea, TextField, useToast } from '@/components/ui';
import { MicButton } from '@/components/MicButton';
import { VoiceFill, type SpokenFields } from '@/components/VoiceFill';
import { PickSelect } from '@/components/PickSelect';
import { ApiError, get, patch, post, upload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { carKey, CATEGORIES, CONDITIONS, governorateOptions, OTHER_BRAND, useLabels } from '@/lib/catalog';
import { formatPrice, fromE164, toE164 } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Category, Condition, Fitment, Part, PartInput, Shop } from '@/lib/types';
import { usePageMeta } from '@/lib/seo';

const MAX_PHOTOS = 8;

interface Draft {
  name: string;
  category: Category | '';
  condition: Condition | '';
  isOriginal: boolean;
  partNumber: string;
  description: string;
  fitments: Fitment[];
  fitsAllCars: boolean;
  images: string[];
  price: string;
  oldPrice: string;
  city: string;
  phone: string;
}

const emptyDraft = (phone: string, city = ''): Draft => ({
  name: '',
  category: '',
  condition: '',
  isOriginal: true,
  partNumber: '',
  description: '',
  fitments: [],
  fitsAllCars: false,
  images: [],
  price: '',
  oldPrice: '',
  city,
  phone: fromE164(phone),
});

/** The step each field is on, to send the seller back to the first error. */
const FIELD_STEP: Record<string, number> = { name: 0, category: 0, condition: 0, partNumber: 0, description: 0, fitments: 1, images: 2 };

const fromPart = (p: Part): Draft => ({
  name: p.name,
  category: p.category,
  condition: p.condition,
  isOriginal: p.isOriginal,
  partNumber: p.partNumber ?? '',
  description: p.description ?? '',
  fitments: p.fitments,
  fitsAllCars: p.fitsAllCars ?? false,
  images: p.images,
  price: String(p.price),
  oldPrice: p.oldPrice ? String(p.oldPrice) : '',
  city: p.city,
  phone: fromE164(p.seller.phone),
});

function Choice<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T | ''; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx('rounded-xl px-4 py-2.5 text-sm font-bold ring-1 transition-colors', value === o.id ? 'bg-navy text-white ring-navy' : 'bg-white ring-line hover:ring-navy')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One tap per make: a shop selling, say, starters for many cars picks the
 * makes and is done; a make picked this way fits all of its models. A make
 * not in the list is typed and added as a chip of its own.
 */
function BrandChips({ fitments, onChange }: { fitments: Fitment[]; onChange: (fitments: Fitment[]) => void }) {
  const { tr, pick } = useI18n();
  const { brands } = useLabels();
  const [filter, setFilter] = useState('');
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const shown = filter.trim()
    ? brands.filter((b) => `${b.nameAr} ${b.nameEn}`.toLowerCase().includes(filter.trim().toLowerCase()))
    : brands;
  const full = fitments.length >= 20;
  const toggle = (brandId: string) =>
    onChange(
      fitments.some((f) => f.brandId === brandId)
        ? fitments.filter((f) => f.brandId !== brandId)
        : [...fitments, { brandId, modelId: null, fromYear: null, toYear: null }],
    );
  // Typed makes on their own, without a model: chips that remove themselves.
  const typedMakes = fitments.filter((f) => f.brandId === OTHER_BRAND && !f.modelName);
  const addTyped = () => {
    const name = typed.trim();
    if (name.length < 2 || full) return;
    if (!typedMakes.some((f) => carKey(f.brandName) === carKey(name))) {
      onChange([...fitments, { brandId: OTHER_BRAND, brandName: name, modelId: null, fromYear: null, toYear: null }]);
    }
    setTyped('');
    setTyping(false);
  };
  const chip = 'flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ring-1 transition-colors disabled:opacity-40';
  return (
    <div>
      {brands.length > 12 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={tr('دوّر على ماركة…', 'Find a make…')}
          className="mb-3 h-10 w-full rounded-xl border border-line px-3 text-sm focus:border-navy focus:outline-none"
        />
      )}
      <div className="flex flex-wrap gap-2">
        {shown.map((b) => {
          const on = fitments.some((f) => f.brandId === b.id);
          return (
            <button key={b.id} type="button" aria-pressed={on} disabled={!on && full} onClick={() => toggle(b.id)} className={cx(chip, on ? 'bg-navy text-white ring-navy' : 'bg-white ring-line hover:ring-navy')}>
              {on && <Check className="h-4 w-4" />}
              {pick(b.nameAr, b.nameEn)}
            </button>
          );
        })}
        {typedMakes.map((f) => (
          <button
            key={carKey(f.brandName)}
            type="button"
            aria-pressed
            onClick={() => onChange(fitments.filter((x) => x !== f))}
            className={cx(chip, 'bg-navy text-white ring-navy')}
          >
            <Check className="h-4 w-4" />
            {f.brandName}
          </button>
        ))}
        {typing ? (
          <span className="flex items-center gap-1.5">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTyped();
                }
              }}
              maxLength={40}
              autoFocus
              placeholder={tr('اسم الماركة', 'Make name')}
              className="h-10 w-36 rounded-xl border border-line px-3 text-sm focus:border-navy focus:outline-none"
            />
            <Button size="sm" onClick={addTyped} disabled={typed.trim().length < 2}>
              {tr('ضيف', 'Add')}
            </Button>
          </span>
        ) : (
          <button type="button" disabled={full} onClick={() => { setTyped(filter.trim()); setTyping(true); }} className={cx(chip, 'border border-dashed border-line bg-white text-orange-deep ring-transparent hover:border-navy')}>
            <Plus className="h-4 w-4" />
            {tr('ماركة تانية', 'Another make')}
          </button>
        )}
      </div>
    </div>
  );
}

/** The model select's choice for a model typed by hand. */
const TYPED = '__typed';

/**
 * One car the part fits: a make and model from the list or typed, and the
 * years, from lists starting in 1998 or typed older. Years left empty mean
 * all of them.
 */
function FitmentDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (f: Fitment) => void }) {
  const { tr, pick } = useI18n();
  const { brands } = useLabels();
  const [brandId, setBrandId] = useState('');
  const [modelId, setModelId] = useState('');
  const [brandName, setBrandName] = useState('');
  const [modelName, setModelName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const typedBrand = brandId === OTHER_BRAND;
  const typedModel = typedBrand || modelId === TYPED;
  const brand = brands.find((b) => b.id === brandId);
  const model = typedModel ? null : (brand?.models.find((m) => m.id === modelId) ?? null);
  const carChosen = Boolean(brandId) && (!typedBrand || brandName.trim().length >= 2) && (typedModel ? modelName.trim().length >= 2 : Boolean(model));
  const yearsOk = (from === '' || yearOk(model, from)) && (to === '' || yearOk(model, to, from === '' ? 0 : Number(from)));

  const reset = () => {
    setBrandId('');
    setModelId('');
    setBrandName('');
    setModelName('');
    setFrom('');
    setTo('');
  };
  const pickYears = (key: string) => {
    setFrom('');
    setTo('');
    return key;
  };

  return (
    <Dialog open={open} onClose={() => { reset(); onClose(); }} title={tr('بتركب على أنهي عربية؟', 'Which car does it fit?')}>
      <div className="space-y-4">
        <Field label={tr('الماركة', 'Make')}>
          <BrandSelect brands={withOtherBrand(brands)} value={brandId} onChange={(id) => { setBrandId(id); setModelId(pickYears('')); }} placeholder={tr('اختار', 'Choose')} ariaLabel={tr('الماركة', 'Make')} />
          {typedBrand && <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={40} placeholder={tr('اكتب الماركة', 'Type the make')} className="mt-2" autoFocus />}
        </Field>
        {brandId && (
          <Field label={tr('الموديل', 'Model')}>
            {!typedBrand && brand && (
              <Select value={modelId} onChange={(e) => setModelId(pickYears(e.target.value))}>
                <option value="">{tr('اختار', 'Choose')}</option>
                {brand.models.map((m) => <option key={m.id} value={m.id}>{pick(m.nameAr, m.nameEn)}</option>)}
                <option value={TYPED}>{tr('مش موجود… هكتبه', "Not listed… I'll type it")}</option>
              </Select>
            )}
            {typedModel && <Input value={modelName} onChange={(e) => setModelName(e.target.value)} maxLength={40} placeholder={tr('اكتب الموديل', 'Type the model')} className={typedBrand ? '' : 'mt-2'} autoFocus={!typedBrand} />}
          </Field>
        )}
        {carChosen && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr('من سنة', 'From')}>
                <YearField key={`from:${brandId}:${modelId}`} model={model} value={from} onChange={setFrom} ariaLabel={tr('من سنة', 'From')} />
              </Field>
              <Field label={tr('لحد سنة', 'To')}>
                <YearField key={`to:${brandId}:${modelId}:${from}`} model={model} value={to} onChange={setTo} minYear={from === '' ? undefined : Number(from)} ariaLabel={tr('لحد سنة', 'To')} />
              </Field>
            </div>
            <p className="-mt-2 text-xs text-ink-soft">{tr('سيب السنين فاضية لو بتركب على كل السنين.', 'Leave the years empty if it fits every year.')}</p>
          </>
        )}
        <Button
          className="w-full"
          disabled={!carChosen || !yearsOk}
          onClick={() => {
            const fromYear = from === '' ? null : Number(from);
            const toYear = to === '' ? fromYear : Math.max(Number(to), fromYear ?? 0);
            onAdd({
              brandId,
              brandName: typedBrand ? brandName.trim() : null,
              modelId: typedModel ? null : modelId,
              modelName: typedModel ? modelName.trim() : null,
              fromYear: fromYear ?? (toYear !== null ? toYear : null),
              toYear,
            });
            reset();
            onClose();
          }}
        >
          {tr('ضيف', 'Add')}
        </Button>
      </div>
    </Dialog>
  );
}

function Photos({ images, onChange }: { images: string[]; onChange: (images: string[]) => void }) {
  const { tr } = useI18n();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  // Keep the latest list while several uploads finish.
  const latest = useRef(images);
  latest.current = images;

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_PHOTOS - images.length;
    const list = Array.from(files).slice(0, room);
    if (files.length > room) toast(tr(`أقصى عدد ${MAX_PHOTOS} صور`, `Up to ${MAX_PHOTOS} photos`));
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const { path } = await upload<{ path: string }>('/uploads/parts', file);
        latest.current = [...latest.current, path];
        onChange(latest.current);
      } catch (error) {
        toast(error instanceof ApiError ? error.message : tr('الصورة مترفعتش', "The photo didn't upload"));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {images.map((src, i) => (
          <div key={src} className="group relative aspect-square overflow-hidden rounded-xl bg-navy-mist">
            <Img size="thumb" src={src} alt="" className="h-full w-full" />
            {i === 0 ? (
              <span className="absolute start-1.5 top-1.5 rounded-md bg-orange px-1.5 text-xs font-bold text-white">{tr('الغلاف', 'Cover')}</span>
            ) : (
              <button type="button" onClick={() => onChange([src, ...images.filter((x) => x !== src)])} className="absolute start-1.5 top-1.5 rounded-md bg-white/90 p-1" aria-label={tr('خليها الغلاف', 'Make cover')}>
                <Star className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => onChange(images.filter((x) => x !== src))} className="absolute end-1.5 top-1.5 rounded-md bg-white/90 p-1 text-red-600" aria-label={tr('امسح', 'Remove')}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`u${i}`} className="flex aspect-square items-center justify-center rounded-xl bg-navy-mist">
            <Loader2 className="h-6 w-6 animate-spin text-navy" />
          </div>
        ))}
        {images.length + uploading < MAX_PHOTOS && (
          <button type="button" onClick={() => fileRef.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-sm font-bold text-ink-soft hover:border-navy hover:text-navy">
            <ImagePlus className="h-7 w-7" />
            {tr('ضيف صور', 'Add photos')}
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void pickFiles(e.target.files); e.target.value = ''; }} />
      <p className="mt-3 text-sm text-ink-soft">{tr('لحد 8 صور، JPG أو PNG أو WebP، كل صورة أقل من 8 ميجا. الصورة الأولى هي اللي بتظهر في البحث.', 'Up to 8 photos (JPG, PNG or WebP, under 8 MB each). The first one shows in search.')}</p>
    </div>
  );
}

export default function Sell() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { tr, lang } = useI18n();
  usePageMeta(editing ? tr('تعديل الإعلان', 'Edit listing') : tr('بيع قطعة', 'Sell a part'));
  const labels = useLabels();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const existing = useQuery({ queryKey: ['part', id], queryFn: () => get<Part>(`/parts/${id}`), enabled: editing });
  // `/sell?copy=<id>`: a new part that starts as a copy of one of the seller's
  // (a shop's similar parts), with no photos or price to reuse by mistake.
  const copyId = useSearchParams()[0].get('copy');
  const copyFrom = useQuery({ queryKey: ['part', copyId], queryFn: () => get<Part>(`/parts/${copyId}`), enabled: Boolean(copyId) && !editing });
  // A shop lists many parts: one page instead of steps, and its governorate
  // and number filled in so they are not typed for every part.
  const myShop = useQuery({ queryKey: ['me', 'shop'], queryFn: () => get<Shop | null>('/shops/mine'), enabled: Boolean(user) && !editing });
  const shop = myShop.data ?? null;
  const quick = Boolean(shop) && !editing;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(user?.phone ?? ''));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fitmentOpen, setFitmentOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editContact, setEditContact] = useState(false);
  const [published, setPublished] = useState<Part[]>([]);
  /** Set after a publish, while the last part's cars and category are kept for the next. */
  const [kept, setKept] = useState(false);

  useEffect(() => {
    if (existing.data) setDraft(fromPart(existing.data));
  }, [existing.data]);

  useEffect(() => {
    if (copyFrom.data) setDraft((d) => ({ ...fromPart(copyFrom.data), images: [], price: '', oldPrice: '', city: d.city || copyFrom.data.city, phone: d.phone }));
  }, [copyFrom.data]);

  useEffect(() => {
    if (shop) setDraft((d) => ({ ...d, city: d.city || shop.city, phone: fromE164(shop.phone) }));
  }, [shop]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  /** What the seller said, put in the fields it fills; the rest stay as they were. */
  const fillFromSpeech = (spoken: SpokenFields) => {
    setDraft((d) => ({
      ...d,
      name: spoken.name ?? d.name,
      category: spoken.category ?? d.category,
      condition: spoken.condition ?? d.condition,
      isOriginal: spoken.isOriginal ?? d.isOriginal,
      partNumber: spoken.partNumber ?? d.partNumber,
      description: spoken.description ?? d.description,
      price: spoken.price ? String(spoken.price) : d.price,
      fitsAllCars: spoken.fitsAllCars || (spoken.fitments.length ? false : d.fitsAllCars),
      fitments: spoken.fitments.length ? spoken.fitments : d.fitments,
    }));
    setErrors({});
    const filled = [
      spoken.name && tr('الاسم', 'name'),
      spoken.category && tr('القسم', 'category'),
      spoken.condition && tr('الحالة', 'condition'),
      (spoken.fitments.length > 0 || spoken.fitsAllCars) && tr('العربيات', 'cars'),
      spoken.price && tr('السعر', 'price'),
      spoken.description && tr('الوصف', 'description'),
    ].filter(Boolean);
    toast(
      filled.length
        ? tr(`ملينا ${filled.join('، ')}. راجعهم وضيف الصور.`, `Filled in the ${filled.join(', ')}. Check them and add photos.`)
        : tr('مقدرناش نطلع بيانات من الكلام، جرّب تاني بوضوح.', "We couldn't get any details from that, try again clearly."),
    );
  };

  const steps = [tr('القطعة', 'Part'), tr('العربيات', 'Cars'), tr('الصور', 'Photos'), tr('السعر', 'Price'), tr('المراجعة', 'Review')];

  const check = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) {
      const n = draft.name.trim().length;
      if (n < 3 || n > 100) e.name = tr('الاسم من 3 لـ 100 حرف', 'Name must be 3–100 characters');
      if (!draft.category) e.category = tr('اختار القسم', 'Choose a category');
      if (!draft.condition) e.condition = tr('اختار الحالة', 'Choose a condition');
    }
    if (s === 1 && !draft.fitsAllCars && !draft.fitments.length) e.fitments = tr('اختار ماركة واحدة على الأقل، أو "كل العربيات"', 'Choose at least one make, or "every car"');
    if (s === 2 && !draft.images.length) e.images = tr('ضيف صورة واحدة على الأقل', 'Add at least one photo');
    if (s === 3) {
      const price = Number(draft.price);
      if (!Number.isInteger(price) || price < 1 || price > 10_000_000) e.price = tr('اكتب سعر صحيح بالجنيه', 'Enter a valid price in pounds');
      if (draft.oldPrice && !(Number(draft.oldPrice) > price)) e.oldPrice = tr('السعر القديم لازم يكون أكبر من الجديد', 'The old price must be higher');
      if (!draft.city) e.city = tr('اختار المحافظة', 'Choose a governorate');
      if (!toE164(draft.phone)) e.phone = tr('اكتب رقم موبايل مصري صحيح', 'Enter an Egyptian mobile number');
    }
    return e;
  };

  const validate = (s: number) => {
    const e = check(s);
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (!validate(step)) return;
    setStep((s) => Math.min(s + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** In the one-page form, brings the first field with an error into view. */
  const showFirstError = () =>
    requestAnimationFrame(() => document.querySelector('[role="alert"], [data-error]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));

  const publish = async () => {
    if (quick) {
      // Every section is on the page, so every error shows at once.
      const all = Object.assign({}, check(0), check(1), check(2), check(3));
      setErrors(all);
      if (Object.keys(all).length) {
        if (all.city || all.phone) setEditContact(true);
        showFirstError();
        return;
      }
    } else {
      for (let s = 0; s < 4; s++) {
        if (!validate(s)) {
          setStep(s);
          return;
        }
      }
    }
    const body: PartInput = {
      name: draft.name.trim(),
      category: draft.category as Category,
      condition: draft.condition as Condition,
      isOriginal: draft.isOriginal,
      price: Number(draft.price),
      oldPrice: draft.oldPrice ? Number(draft.oldPrice) : null,
      partNumber: draft.partNumber.trim() || null,
      description: draft.description.trim() || null,
      images: draft.images,
      fitments: draft.fitsAllCars ? [] : draft.fitments,
      fitsAllCars: draft.fitsAllCars,
      city: draft.city,
      phone: toE164(draft.phone)!,
    };
    setPublishing(true);
    try {
      const part = editing ? await patch<Part>(`/parts/${id}`, body) : await post<Part>('/parts', body);
      queryClient.invalidateQueries({ queryKey: ['part', part.id] });
      queryClient.invalidateQueries({ queryKey: ['me', 'parts'] });
      queryClient.invalidateQueries({ queryKey: ['home'] });
      toast(editing ? tr('اتحفظت التعديلات', 'Changes saved') : tr('اتنشر إعلانك', 'Your listing is live'));
      if (quick) {
        // Straight on to the next part. A shop's parts in a row tend to share
        // cars, category and condition, so those stay; the name, photos and
        // price start empty.
        setPublished((list) => [part, ...list]);
        setDraft((d) => ({
          ...emptyDraft('', d.city),
          phone: d.phone,
          category: d.category,
          condition: d.condition,
          isOriginal: d.isOriginal,
          fitments: d.fitments,
          fitsAllCars: d.fitsAllCars,
        }));
        setKept(true);
        setErrors({});
        window.scrollTo({ top: 0, behavior: 'smooth' });
        requestAnimationFrame(() => document.getElementById('part-name')?.focus({ preventScroll: true }));
        return;
      }
      navigate(`/parts/${part.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.errors.length) {
        const map: Record<string, string> = {};
        error.errors.forEach((x) => (map[x.field.split('.')[0]] = x.message));
        setErrors(map);
        if (quick) {
          if (map.city || map.phone) setEditContact(true);
          showFirstError();
        } else {
          setStep(Math.min(...error.errors.map((x) => FIELD_STEP[x.field.split('.')[0]] ?? 3)));
        }
      }
      toast(error instanceof ApiError ? error.message : tr('محصلش نشر، حاول تاني', "Couldn't publish, try again"));
    } finally {
      setPublishing(false);
    }
  };

  if (editing && existing.isLoading) return <PageSpinner />;
  if (editing && existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
  if (!editing && myShop.isLoading) return <PageSpinner />;

  /** Whether a section is on screen: all of them in the one-page form. */
  const shows = (s: number) => (quick ? s < 4 : step === s);
  const heading = (s: number) => quick && <h2 className="mb-4 text-lg font-extrabold">{s + 1}. {steps[s]}</h2>;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
      <h1 className="text-2xl font-extrabold md:text-3xl">{editing ? tr('عدّل الإعلان', 'Edit listing') : tr('بيع قطعة', 'Sell a part')}</h1>
      {quick && shop && (
        <p className="mt-2 flex items-center gap-2 text-ink-soft">
          <Store className="h-4 w-4 shrink-0" />
          {tr(`القطع هتتنشر باسم محل ${shop.name}`, `Parts are listed under ${shop.name}`)}
        </p>
      )}

      {published.length > 0 && (
        <div className="mt-6 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
          <p className="flex items-center gap-2 font-bold text-emerald-800">
            <CheckCircle2 className="h-5 w-5" />
            {tr(`نشرت ${published.length} ${published.length === 1 ? 'قطعة' : 'قطع'} دلوقتي. ضيف اللي بعدها تحت.`, `${published.length} published just now. Add the next one below.`)}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {published.slice(0, 6).map((p) => (
              <li key={p.id}>
                <Link to={`/parts/${p.id}`} className="rounded-lg bg-white px-2.5 py-1 font-bold text-navy ring-1 ring-emerald-200 hover:underline">{p.name}</Link>
              </li>
            ))}
            {published.length > 6 && <li className="px-1 py-1 text-emerald-800">+{published.length - 6}</li>}
            <li>
              <Link to="/account/parts" className="inline-block px-1 py-1 font-bold text-emerald-800 underline">{tr('كل قطعي', 'All my parts')}</Link>
            </li>
          </ul>
          {kept && (
            <p className="mt-3 text-sm text-emerald-900">
              {tr('سبنالك القسم والحالة والعربيات زي القطعة اللي فاتت. اكتب الاسم والسعر وضيف الصورة.', 'We kept the category, condition and cars from the last part. Add the name, price and photo.')}{' '}
              <button
                type="button"
                className="font-bold underline"
                onClick={() => {
                  setDraft((d) => ({ ...emptyDraft('', d.city), phone: d.phone }));
                  setKept(false);
                }}
              >
                {tr('ابدأ من الصفر', 'Start blank')}
              </button>
            </p>
          )}
        </div>
      )}

      {!quick && (
      <ol className="mt-6 flex gap-1.5" aria-label={tr('الخطوات', 'Steps')}>
        {steps.map((label, i) => (
          <li key={label} className="flex-1">
            <button
              type="button"
              disabled={i > step}
              onClick={() => setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className="w-full text-start disabled:cursor-default"
            >
              <span className={cx('block h-1.5 rounded-full', i <= step ? 'bg-orange' : 'bg-line')} />
              <span className={cx('mt-1.5 hidden text-xs font-bold sm:block', i === step ? 'text-navy' : 'text-ink-muted')}>{i + 1}. {label}</span>
            </button>
          </li>
        ))}
      </ol>
      )}

      <div className={cx('mt-6', quick ? 'space-y-4' : 'rounded-2xl bg-white p-5 ring-1 ring-line md:p-6')}>
        {shows(0) && (
          <div className={cx('space-y-5', quick && 'rounded-2xl bg-white p-5 ring-1 ring-line md:p-6')}>
            {heading(0)}
            {!editing && <VoiceFill onFilled={fillFromSpeech} />}
            <Field label={tr('اسم القطعة', 'Part name')} error={errors.name} htmlFor="part-name">
              <div className="flex gap-2">
                <Input id="part-name" placeholder={tr('مثلاً: طقم تيل فرامل أمامي', 'e.g. Front brake pad set')} value={draft.name} onChange={(e) => set('name', e.target.value)} invalid={Boolean(errors.name)} maxLength={100} />
                <MicButton label={tr('قول اسم القطعة', 'Say the part name')} onText={(text) => set('name', text.slice(0, 100))} />
              </div>
            </Field>
            <Field label={tr('القسم', 'Category')} error={errors.category}>
              <Choice options={CATEGORIES.map((c) => ({ id: c.id, label: lang === 'ar' ? c.ar : c.en }))} value={draft.category} onChange={(v) => set('category', v)} />
            </Field>
            <Field label={tr('الحالة', 'Condition')} error={errors.condition}>
              <Choice options={CONDITIONS.map((c) => ({ id: c.id, label: lang === 'ar' ? c.ar : c.en }))} value={draft.condition} onChange={(v) => set('condition', v)} />
            </Field>
            <Field label={tr('أصلي ولا تجاري؟', 'Original or aftermarket?')}>
              <Choice options={[{ id: 'y', label: tr('أصلي', 'Original') }, { id: 'n', label: tr('تجاري', 'Aftermarket') }]} value={draft.isOriginal ? 'y' : 'n'} onChange={(v) => set('isOriginal', v === 'y')} />
            </Field>
            <TextField label={tr('رقم القطعة (اختياري)', 'Part number (optional)')} dir="ltr" value={draft.partNumber} onChange={(e) => set('partNumber', e.target.value)} maxLength={40} error={errors.partNumber} />
            <Field label={tr('الوصف (اختياري)', 'Description (optional)')} error={errors.description} hint={`${draft.description.length}/1000`}>
              <div className="flex items-start gap-2">
                <Textarea value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} placeholder={tr('حالتها، فيها ضمان ولا لأ، أي حاجة المشتري محتاج يعرفها', 'Its state, any warranty, anything a buyer should know')} />
                <MicButton label={tr('قول الوصف', 'Say the description')} onText={(text) => setDraft((d) => ({ ...d, description: `${d.description.trim()} ${text}`.trim().slice(0, 1000) }))} />
              </div>
            </Field>
          </div>
        )}

        {shows(1) && (
          <div className={cx(quick && 'rounded-2xl bg-white p-5 ring-1 ring-line md:p-6')}>
            {heading(1)}
            <p className="mb-4 text-ink-soft">
              {tr('اختار الماركات اللي القطعة بتركب عليها. الموديل والسنة اختياري.', 'Pick the makes it fits. Model and year are optional.')}
            </p>
            <label className={cx('mb-4 flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-1 transition-colors', draft.fitsAllCars ? 'bg-emerald-50 ring-emerald-300' : 'bg-white ring-line hover:ring-navy')}>
              <input type="checkbox" checked={draft.fitsAllCars} onChange={(e) => set('fitsAllCars', e.target.checked)} className="h-5 w-5 accent-emerald-600" />
              <span>
                <span className="block font-bold">{tr('بتركب على كل العربيات', 'Fits every car')}</span>
                <span className="block text-xs text-ink-soft">{tr('زي الزيوت والمساحات والعدد', 'Like oils, wipers and tools')}</span>
              </span>
            </label>
            {!draft.fitsAllCars && (
              <>
                <BrandChips
                  fitments={draft.fitments}
                  onChange={(fitments) => set('fitments', fitments)}
                />
                {draft.fitments.some((f) => f.modelId || f.modelName) && (
                  <ul className="mt-3 space-y-2">
                    {draft.fitments.map((f, i) =>
                      f.modelId || f.modelName ? (
                        <li key={i} className="flex items-center justify-between rounded-xl bg-canvas px-4 py-2.5 text-sm">
                          <span className="font-bold">{labels.fitment(f)}</span>
                          <button type="button" onClick={() => set('fitments', draft.fitments.filter((_, j) => j !== i))} className="text-red-600" aria-label={tr('امسح', 'Remove')}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      ) : null,
                    )}
                  </ul>
                )}
                {draft.fitments.length < 20 && (
                  <button type="button" className="mt-3 text-sm font-bold text-orange-deep hover:underline" onClick={() => setFitmentOpen(true)}>
                    <Plus className="me-1 inline h-4 w-4" />
                    {tr('حدد موديل وسنة معينة (اختياري)', 'Pick a specific model and years (optional)')}
                  </button>
                )}
              </>
            )}
            {errors.fitments && <p data-error className="mt-2 text-sm text-red-600">{errors.fitments}</p>}
          </div>
        )}

        {shows(2) && (
          <div className={cx(quick && 'rounded-2xl bg-white p-5 ring-1 ring-line md:p-6')}>
            {heading(2)}
            <Photos images={draft.images} onChange={(images) => set('images', images)} />
            {errors.images && <p data-error className="mt-2 text-sm text-red-600">{errors.images}</p>}
          </div>
        )}

        {shows(3) && (
          <div className={cx('space-y-5', quick && 'rounded-2xl bg-white p-5 ring-1 ring-line md:p-6')}>
            {heading(3)}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={tr('السعر بالجنيه', 'Price (EGP)')} type="number" inputMode="numeric" min={1} value={draft.price} onChange={(e) => set('price', e.target.value)} error={errors.price} />
              <TextField label={tr('السعر قبل الخصم (اختياري)', 'Price before discount (optional)')} type="number" inputMode="numeric" min={1} value={draft.oldPrice} onChange={(e) => set('oldPrice', e.target.value)} error={errors.oldPrice} />
            </div>
            {quick && !editContact ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3 text-sm">
                <span className="text-ink-soft">
                  {labels.city(draft.city)} · <span dir="ltr" className="font-bold text-ink">{draft.phone}</span>
                  <span className="block text-xs">{tr('من بيانات المحل', "From your shop's details")}</span>
                </span>
                <button type="button" onClick={() => setEditContact(true)} className="shrink-0 font-bold text-orange-deep hover:underline">
                  {tr('غيّر', 'Change')}
                </button>
              </div>
            ) : (
              <>
                <Field label={tr('المحافظة', 'Governorate')} error={errors.city}>
                  <PickSelect options={governorateOptions(labels.city)} value={draft.city} onChange={(v) => set('city', v)} placeholder={tr('اختار', 'Choose')} ariaLabel={tr('المحافظة', 'Governorate')} searchLabel={tr('دوّر على المحافظة…', 'Find a governorate…')} invalid={Boolean(errors.city)} />
                </Field>
                <TextField label={tr('رقم التواصل', 'Contact number')} type="tel" dir="ltr" value={draft.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} hint={tr('المشترين هيكلموك عليه أو على واتساب.', 'Buyers call or WhatsApp you on it.')} />
              </>
            )}
          </div>
        )}

        {!quick && step === 4 && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <Img size="thumb" src={draft.images[0]} alt="" className="h-24 w-24 shrink-0 rounded-xl" />
              <div>
                <p className="text-lg font-extrabold">{draft.name}</p>
                <p className="text-sm text-ink-soft">
                  {draft.category && labels.category(draft.category)} · {draft.condition && labels.condition(draft.condition)} · {draft.isOriginal ? tr('أصلي', 'Original') : tr('تجاري', 'Aftermarket')}
                </p>
                <p className="mt-1 text-xl font-extrabold">{draft.price && formatPrice(Number(draft.price), lang)}</p>
              </div>
            </div>
            <dl className="divide-y divide-line text-sm">
              <div className="flex justify-between py-2.5"><dt className="text-ink-soft">{tr('العربيات', 'Cars')}</dt><dd className="text-end font-bold">{draft.fitsAllCars ? tr('كل العربيات', 'Every car') : draft.fitments.map((f) => labels.fitment(f)).join('، ')}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-ink-soft">{tr('الصور', 'Photos')}</dt><dd className="font-bold">{draft.images.length}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-ink-soft">{tr('المحافظة', 'Governorate')}</dt><dd className="font-bold">{labels.city(draft.city)}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-ink-soft">{tr('رقم التواصل', 'Contact number')}</dt><dd className="font-bold" dir="ltr">{draft.phone}</dd></div>
            </dl>
          </div>
        )}
      </div>

      {quick ? (
        <div className="sticky bottom-0 -mx-4 mt-6 bg-canvas/95 px-4 py-3 backdrop-blur">
          <Button variant="accent" className="w-full" loading={publishing} onClick={publish}>
            <Check className="h-5 w-5" />
            {tr('انشر القطعة', 'Publish part')}
          </Button>
        </div>
      ) : (
      <div className="mt-6 flex gap-3">
        {step > 0 && (
          <Button variant="outline" onClick={() => setStep(step - 1)}>
            {tr('رجوع', 'Back')}
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button className="flex-1" onClick={next}>
            {tr('التالي', 'Next')}
          </Button>
        ) : (
          <Button variant="accent" className="flex-1" loading={publishing} onClick={publish}>
            <Check className="h-5 w-5" />
            {editing ? tr('احفظ التعديلات', 'Save changes') : tr('انشر الإعلان', 'Publish listing')}
          </Button>
        )}
      </div>
      )}

      <FitmentDialog open={fitmentOpen} onClose={() => setFitmentOpen(false)} onAdd={(f) => set('fitments', [...draft.fitments.filter((x) => x.modelId || x.modelName || x.brandId !== f.brandId || x.brandId === OTHER_BRAND), f])} />
    </div>
  );
}
