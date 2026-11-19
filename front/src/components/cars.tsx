import { AlertTriangle, CarFront, Check, ChevronDown, ChevronLeft, ChevronRight, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { brandLogo, carId, carKey, modelYears, OLDEST_YEAR, OTHER_BRAND, useLabels, yearRange } from '@/lib/catalog';
import { addCar, garage, isFollowed, MAX_CARS, removeCar, toggleCar } from '@/lib/collections';
import { useI18n } from '@/lib/i18n';
import type { CarBrand, CarModel, Fitment, GarageCar } from '@/lib/types';

import { Button, cx, Dialog, Input, Select, useConfirm } from './ui';

/**
 * A car as an Egyptian number plate: the blue band with مصر / EGYPT on top,
 * the car where the letters and numbers go.
 */
export function CarPlate({
  car,
  active,
  onClick,
  size = 'md',
}: {
  car: GarageCar;
  active?: boolean;
  onClick?: () => void;
  size?: 'md' | 'lg';
}) {
  const labels = useLabels();
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={cx(
        'shrink-0 overflow-hidden rounded-lg border-2 bg-white text-navy transition-all',
        active ? 'border-orange shadow-[0_0_0_3px_rgba(247,127,0,0.35)]' : 'border-navy-deep/80',
        onClick && 'hover:-translate-y-0.5',
        size === 'lg' ? 'min-w-48' : 'min-w-36',
      )}
    >
      <div className="flex items-center justify-between bg-plate px-2 py-0.5 text-[10px] font-bold text-white" dir="ltr">
        <span>EGYPT</span>
        <span>مصر</span>
      </div>
      <div className={cx('flex items-center gap-2 px-3', size === 'lg' ? 'py-2' : 'py-1.5')}>
        <span className={cx('font-extrabold leading-tight', size === 'lg' ? 'text-lg' : 'text-sm')}>
          {labels.carName(car)}
        </span>
        <span className="ms-auto border-s-2 border-navy-deep/20 ps-2 text-sm font-bold tabular-nums" dir="ltr">
          {car.year}
        </span>
      </div>
    </Tag>
  );
}

/** A make's logo, or its initial when there is none or it fails to load. */
export function BrandLogo({ brand, className }: { brand: CarBrand; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = brandLogo(brand.id);
  if (brand.id === OTHER_BRAND) {
    return (
      <span className={cx('flex items-center justify-center text-orange-deep', className)} aria-hidden>
        <Plus className="h-4 w-4" />
      </span>
    );
  }
  if (!src || failed) {
    return (
      <span className={cx('flex items-center justify-center font-extrabold text-navy', className)} dir="ltr" aria-hidden>
        {brand.nameEn.charAt(0)}
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" className={cx('object-contain', className)} onError={() => setFailed(true)} />;
}


/**
 * A make dropdown with logos, in place of a `<select>` (whose options can only
 * be text). The list is fixed to the viewport so dialogs that scroll don't clip it.
 */
export function BrandSelect({
  brands,
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  brands: CarBrand[];
  value: string;
  onChange: (brandId: string) => void;
  placeholder: string;
  ariaLabel?: string;
}) {
  const { tr, pick, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = brands.find((b) => b.id === value);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? brands.filter((b) => b.nameAr.includes(f) || b.nameEn.toLowerCase().includes(f)) : brands;
  }, [brands, filter]);

  const close = (focusButton = true) => {
    setOpen(false);
    setFilter('');
    if (focusButton) buttonRef.current?.focus();
  };
  const choose = (brand: CarBrand) => {
    onChange(brand.id);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => buttonRef.current && setRect(buttonRef.current.getBoundingClientRect());
    place();
    const outside = (e: PointerEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  useEffect(() => {
    if (open) setHighlight(Math.max(0, shown.findIndex((b) => b.id === value)));
    // Only when it opens; typing resets it to the first match.
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, rect]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Keeps a surrounding <dialog> open.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[highlight]) choose(shown[highlight]);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  // Opens upwards when there is no room below.
  const below = rect ? document.documentElement.clientHeight - rect.bottom : 0;
  const up = rect ? below < 300 && rect.top > below : false;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={cx(
          'flex h-12 w-full items-center gap-2.5 rounded-xl border bg-white px-3 text-start text-[15px] font-normal text-navy focus:outline-none focus:ring-2 focus:ring-navy/15',
          open ? 'border-navy ring-2 ring-navy/15' : 'border-line focus:border-navy',
        )}
      >
        {selected ? (
          <>
            <BrandLogo brand={selected} className="h-7 w-8 shrink-0 text-sm" />
            <span className="flex-1 truncate font-bold">{pick(selected.nameAr, selected.nameEn)}</span>
          </>
        ) : (
          <span className="flex-1 truncate text-ink-muted">{placeholder}</span>
        )}
        <ChevronDown className={cx('h-4 w-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && rect && (
        <div
          ref={listRef}
          onKeyDown={onKeyDown}
          className="fixed z-50 flex max-h-80 flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-line"
          style={{
            // Lines up with the field's start edge and grows towards its end.
            ...(lang === 'ar' ? { right: document.documentElement.clientWidth - rect.right } : { left: rect.left }),
            width: Math.min(Math.max(rect.width, 240), document.documentElement.clientWidth - 16),
            ...(up ? { bottom: document.documentElement.clientHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
          }}
        >
          <div className="relative border-b border-line p-2">
            <Search className="pointer-events-none absolute start-5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              autoFocus
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setHighlight(0);
              }}
              placeholder={tr('دوّر على الماركة…', 'Find a make…')}
              aria-label={tr('دوّر على الماركة', 'Find a make')}
              aria-controls={listId}
              aria-activedescendant={shown[highlight] ? `${listId}-${shown[highlight].id}` : undefined}
              className="h-10 w-full rounded-lg bg-canvas pe-3 ps-9 text-sm text-navy placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-navy/15"
            />
          </div>
          <ul id={listId} role="listbox" aria-label={ariaLabel} className="overflow-y-auto p-1.5">
            {shown.map((brand, i) => (
              <li
                key={brand.id}
                id={`${listId}-${brand.id}`}
                data-index={i}
                role="option"
                aria-selected={brand.id === value}
                onPointerMove={() => setHighlight(i)}
                onClick={() => choose(brand)}
                className={cx(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-bold',
                  i === highlight && 'bg-canvas',
                  brand.id === value && 'text-orange-deep',
                )}
              >
                <BrandLogo brand={brand} className="h-7 w-9 shrink-0 text-sm" />
                <span className="flex-1 truncate">{pick(brand.nameAr, brand.nameEn)}</span>
                {brand.id === value && <Check className="h-4 w-4 shrink-0" />}
              </li>
            ))}
            {!shown.length && <li className="px-3 py-6 text-center text-sm text-ink-muted">{tr('مفيش ماركة بالاسم ده', 'No make by that name')}</li>}
          </ul>
        </div>
      )}
    </>
  );
}

/** The make list with a last choice for a make not in it, typed after. */
export function withOtherBrand(brands: CarBrand[]): CarBrand[] {
  return [...brands, { id: OTHER_BRAND, nameAr: 'ماركة تانية… هكتبها', nameEn: 'Another make… type it', models: [] }];
}

/**
 * A year from a list (1998 on, or the model's first year if older), or typed
 * when older, down to [OLDEST_YEAR]. [value] is the year as text, "" for none.
 */
export function YearField({
  model,
  value,
  onChange,
  ariaLabel,
  disabled,
  minYear,
}: {
  /** The catalog model, or null for a typed one. */
  model: { fromYear: number; toYear: number | null } | null;
  value: string;
  onChange: (year: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  /** Earliest year allowed (a "to" year after a "from" year). */
  minYear?: number;
}) {
  const { tr } = useI18n();
  const [first, last] = modelYears(model);
  const years = yearRange([Math.max(first, minYear ?? 0), last]).filter((y) => y >= (minYear ?? 0));
  const [typing, setTyping] = useState(() => value !== '' && Number(value) < first);
  const lowest = Math.max(OLDEST_YEAR, minYear ?? 0);
  const typedBad = typing && value !== '' && (Number(value) < lowest || Number(value) > last);
  if (typing) {
    return (
      <div className="flex gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={lowest}
          max={first - 1}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, 4))}
          placeholder={String(first - 10)}
          aria-label={ariaLabel}
          invalid={typedBad}
          className="flex-1"
          dir="ltr"
          autoFocus
        />
        <button
          type="button"
          onClick={() => {
            setTyping(false);
            onChange('');
          }}
          className="shrink-0 rounded-xl px-3 text-sm font-bold text-ink-soft hover:bg-canvas"
        >
          {tr('القايمة', 'List')}
        </button>
      </div>
    );
  }
  return (
    <Select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        if (e.target.value === 'older') {
          setTyping(true);
          onChange('');
        } else onChange(e.target.value);
      }}
    >
      <option value="">{tr('اختار السنة', 'Choose year')}</option>
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
      {first > lowest && <option value="older">{tr(`أقدم من ${first}… اكتبها`, `Older than ${first}… type it`)}</option>}
    </Select>
  );
}

/** Whether [year] (as text) is one [YearField] accepts for [model]. */
export function yearOk(model: { fromYear: number; toYear: number | null } | null, year: string, minYear = 0): boolean {
  const n = Number(year);
  return year !== '' && Number.isInteger(n) && n >= Math.max(OLDEST_YEAR, minYear) && n <= modelYears(model)[1];
}

type Step =
  | { kind: 'brand' }
  | { kind: 'model'; brand: CarBrand }
  /** A make or model not in the list: [brand] null when the make is typed too. */
  | { kind: 'typed'; brand: CarBrand | null }
  | { kind: 'year'; car: Omit<GarageCar, 'year'>; model: CarModel | null };

/** Make → model → year; a make or model not in the list can be typed, and an older year too. */
export function CarPicker({
  open,
  onClose,
  onPick,
  title,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (car: GarageCar) => void;
  title?: string;
}) {
  const { tr, pick, lang } = useI18n();
  const labels = useLabels();
  const { brands } = labels;
  const [step, setStep] = useState<Step>({ kind: 'brand' });
  const [filter, setFilter] = useState('');
  const [typedBrand, setTypedBrand] = useState('');
  const [typedModel, setTypedModel] = useState('');
  const [olderYear, setOlderYear] = useState('');
  const Back = lang === 'ar' ? ChevronRight : ChevronLeft;
  const Next = lang === 'ar' ? ChevronLeft : ChevronRight;

  const close = () => {
    setStep({ kind: 'brand' });
    setFilter('');
    setTypedBrand('');
    setTypedModel('');
    setOlderYear('');
    onClose();
  };
  const finish = (car: Omit<GarageCar, 'year'>, year: number) => {
    onPick({ ...car, year });
    close();
  };

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const match = (x: { nameAr: string; nameEn: string }) => !f || x.nameAr.includes(f) || x.nameEn.toLowerCase().includes(f);
    if (step.kind === 'brand') return brands.filter(match);
    if (step.kind === 'model') return step.brand.models.filter(match);
    return [];
  }, [brands, step, filter]);

  const [first, last] = step.kind === 'year' ? modelYears(step.model) : [0, 0];
  const years = step.kind === 'year' ? yearRange([first, last]) : [];

  const heading =
    step.kind === 'brand'
      ? tr('اختار الماركة', 'Choose the make')
      : step.kind === 'model'
        ? pick(step.brand.nameAr, step.brand.nameEn)
        : step.kind === 'typed'
          ? step.brand
            ? `${pick(step.brand.nameAr, step.brand.nameEn)}: ${tr('اكتب الموديل', 'type the model')}`
            : tr('اكتب الماركة والموديل', 'Type the make and model')
          : labels.carName(step.car);

  const back = () => {
    setFilter('');
    if (step.kind === 'model' || (step.kind === 'typed' && !step.brand)) setStep({ kind: 'brand' });
    else if (step.kind === 'typed' && step.brand) setStep({ kind: 'model', brand: step.brand });
    else if (step.kind === 'year') {
      const brand = brands.find((b) => b.id === step.car.brandId);
      setStep(step.model && brand ? { kind: 'model', brand } : { kind: 'typed', brand: brand ?? null });
    }
  };

  const notListed = (label: string, onClick: () => void) => (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 py-3 text-start text-sm font-bold text-orange-deep hover:underline">
        <Plus className="h-4 w-4" />
        {label}
      </button>
    </li>
  );

  const typedReady = typedModel.trim().length >= 2 && (step.kind !== 'typed' || step.brand || typedBrand.trim().length >= 2);

  return (
    <Dialog open={open} onClose={close} title={title ?? tr('ضيف عربيتك', 'Add your car')}>
      <div className="mb-3 flex items-center gap-2">
        {step.kind !== 'brand' && (
          <button onClick={back} className="rounded-lg p-1 hover:bg-canvas" aria-label={tr('رجوع', 'Back')}>
            <Back className="h-5 w-5" />
          </button>
        )}
        <p className="font-bold">{heading}</p>
      </div>
      {(step.kind === 'brand' || step.kind === 'model') && (
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tr('دوّر…', 'Filter…')} className="mb-3 h-10" autoFocus />
      )}
      {step.kind === 'typed' ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!typedReady) return;
            setStep({
              kind: 'year',
              model: null,
              car: step.brand
                ? { brandId: step.brand.id, brandName: null, modelId: null, modelName: typedModel.trim() }
                : { brandId: OTHER_BRAND, brandName: typedBrand.trim(), modelId: null, modelName: typedModel.trim() },
            });
          }}
        >
          {!step.brand && (
            <Input value={typedBrand} onChange={(e) => setTypedBrand(e.target.value)} maxLength={40} placeholder={tr('الماركة، مثلاً: بروتون', 'Make, e.g. Proton')} autoFocus />
          )}
          <Input value={typedModel} onChange={(e) => setTypedModel(e.target.value)} maxLength={40} placeholder={tr('الموديل، مثلاً: كراون', 'Model, e.g. Crown')} autoFocus={Boolean(step.brand)} />
          <Button type="submit" className="w-full" disabled={!typedReady}>
            {tr('التالي', 'Next')}
          </Button>
        </form>
      ) : step.kind === 'year' ? (
        <div>
          <div className="grid grid-cols-4 gap-2">
            {years.map((year) => (
              <button
                key={year}
                onClick={() => finish(step.car, year)}
                className="rounded-xl border border-line py-2.5 font-bold tabular-nums hover:border-navy hover:bg-navy-mist"
              >
                {year}
              </button>
            ))}
          </div>
          {first > OLDEST_YEAR && (
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (yearOk(step.model, olderYear) && Number(olderYear) < first) finish(step.car, Number(olderYear));
              }}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={OLDEST_YEAR}
                max={first - 1}
                value={olderYear}
                onChange={(e) => setOlderYear(e.target.value.slice(0, 4))}
                placeholder={tr(`سنة أقدم من ${first}`, `A year before ${first}`)}
                className="flex-1"
                dir="ltr"
              />
              <Button type="submit" variant="outline" disabled={!(yearOk(step.model, olderYear) && Number(olderYear) < first)}>
                {tr('اختار', 'Choose')}
              </Button>
            </form>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => {
                  setFilter('');
                  if (step.kind === 'brand') setStep({ kind: 'model', brand: item as CarBrand });
                  else
                    setStep({
                      kind: 'year',
                      model: item as CarModel,
                      car: { brandId: step.brand.id, brandName: null, modelId: item.id, modelName: null },
                    });
                }}
                className="flex w-full items-center gap-3 py-3 text-start font-semibold hover:text-orange-deep"
              >
                {step.kind === 'brand' && <BrandLogo brand={item as CarBrand} className="h-7 w-9 shrink-0 text-sm" />}
                <span className="flex-1">{pick(item.nameAr, item.nameEn)}</span>
                <Next className="h-4 w-4 text-ink-muted" />
              </button>
            </li>
          ))}
          {step.kind === 'brand'
            ? notListed(tr('ماركتي مش موجودة، هكتبها', "My make isn't listed, I'll type it"), () => {
                setFilter('');
                setTypedBrand(filter.trim());
                setStep({ kind: 'typed', brand: null });
              })
            : notListed(tr('الموديل مش موجود، هكتبه', "My model isn't listed, I'll type it"), () => {
                setFilter('');
                setTypedModel(filter.trim());
                setStep({ kind: 'typed', brand: step.brand });
              })}
        </ul>
      )}
    </Dialog>
  );
}

/** The garage editor: follow one car or all, add, remove. */
export function GarageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tr } = useI18n();
  const labels = useLabels();
  const confirm = useConfirm();
  const state = garage.use();
  const { cars } = state;
  const [picking, setPicking] = useState(false);

  return (
    <>
      <Dialog open={open && !picking} onClose={onClose} title={tr('عربياتي', 'My cars')}>
        <p className="mb-4 text-sm text-ink-soft">
          {tr(
            `ضيف لحد ${MAX_CARS} عربيات، والرئيسية هتوريك القطع اللي بتركب عليها.`,
            `Add up to ${MAX_CARS} cars and the home page shows parts that fit them.`,
          )}
        </p>
        <ul className="space-y-2">
          {cars.length > 1 && (
            <li>
              <button
                onClick={() => toggleCar(-1)}
                className={cx('flex w-full items-center justify-between rounded-xl border px-4 py-3 font-bold', isFollowed(state, -1) ? 'border-orange bg-orange-mist' : 'border-line')}
              >
                {tr('كل عربياتي', 'All my cars')}
                {isFollowed(state, -1) && <Check className="h-5 w-5 text-orange-deep" />}
              </button>
            </li>
          )}
          {cars.map((car, i) => (
            <li key={carId(car)} className="flex items-center gap-2">
              <button
                onClick={() => toggleCar(i)}
                className={cx('flex flex-1 items-center justify-between rounded-xl border px-4 py-3 text-start font-bold', isFollowed(state, i) ? 'border-orange bg-orange-mist' : 'border-line')}
              >
                {labels.car(car)}
                {isFollowed(state, i) && <Check className="h-5 w-5 text-orange-deep" />}
              </button>
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: tr('تشيل العربية دي؟', 'Remove this car?'),
                    body: labels.car(car),
                    confirmLabel: tr('شيلها', 'Remove'),
                    danger: true,
                  });
                  if (ok) removeCar(i);
                }}
                className="rounded-xl p-3 text-red-600 hover:bg-red-50" aria-label={tr('امسح', 'Remove')}>
                <Trash2 className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ul>
        {cars.length < MAX_CARS && (
          <Button variant="outline" className="mt-4 w-full" onClick={() => setPicking(true)}>
            <Plus className="h-4 w-4" />
            {tr('ضيف عربية', 'Add a car')}
          </Button>
        )}
      </Dialog>
      <CarPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(car) => {
          addCar(car);
        }}
      />
    </>
  );
}

/**
 * A fitment covers the car: its whole make, or its model and year. Typed
 * makes and models match by name, as the server does.
 */
export const fitsCar = (car: GarageCar, fitments: Fitment[], fitsAllCars = false) =>
  fitsAllCars ||
  fitments.some((f) => {
    const sameBrand = car.brandId === OTHER_BRAND ? f.brandId === OTHER_BRAND && carKey(f.brandName) === carKey(car.brandName) : f.brandId === car.brandId;
    if (!sameBrand) return false;
    const inYears = f.fromYear == null || (car.year >= f.fromYear && car.year <= (f.toYear ?? 9999));
    if (!f.modelId && !f.modelName) return true;
    if (f.modelId) return f.modelId === car.modelId && inYears;
    return carKey(f.modelName) === carKey(car.modelName) && inYears;
  });

/**
 * Whether a part fits the cars in the garage, from its fitments: green when
 * one does, amber when none does, and a way to add a car when there is none.
 */
export function FitCheck({ fitments, fitsAllCars = false }: { fitments: Fitment[]; fitsAllCars?: boolean }) {
  const { tr } = useI18n();
  const labels = useLabels();
  const { cars } = garage.use();
  const [picking, setPicking] = useState(false);
  const fitting = cars.filter((car) => fitsCar(car, fitments, fitsAllCars));
  const others = cars.filter((car) => !fitsCar(car, fitments, fitsAllCars));

  const picker = <CarPicker open={picking} onClose={() => setPicking(false)} onPick={addCar} />;

  if (!cars.length) {
    return (
      <div data-nosnippet="" className="flex items-center gap-3 rounded-2xl bg-navy-mist p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-navy">
          <CarFront className="h-5 w-5" />
        </span>
        <p className="flex-1 text-sm font-bold">{tr('عايز تعرف لو القطعة دي بتركب على عربيتك؟', 'Want to know if this part fits your car?')}</p>
        <Button size="sm" variant="outline" onClick={() => setPicking(true)} className="shrink-0 bg-white">
          <Plus className="h-4 w-4" />
          {tr('ضيف عربيتك', 'Add your car')}
        </Button>
        {picker}
      </div>
    );
  }

  if (fitting.length) {
    return (
      <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check className="h-5 w-5" strokeWidth={3} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold text-emerald-800">
              {fitting.length === 1
                ? tr(`بتركب على عربيتك ${labels.car(fitting[0])}`, `Fits your ${labels.car(fitting[0])}`)
                : tr('بتركب على عربياتك', 'Fits your cars')}
            </p>
            {fitting.length > 1 && <p className="mt-0.5 text-sm font-bold text-emerald-800">{fitting.map((c) => labels.car(c)).join('، ')}</p>}
            {others.length > 0 && (
              <p className="mt-1 text-xs text-emerald-900/70">
                {tr(`مش بتركب على: ${others.map((c) => labels.car(c)).join('، ')}`, `Doesn't fit: ${others.map((c) => labels.car(c)).join(', ')}`)}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-amber-900">
            {cars.length === 1
              ? tr(`مش متسجّل إنها بتركب على ${labels.car(cars[0])}`, `Not listed as fitting your ${labels.car(cars[0])}`)
              : tr('مش متسجّل إنها بتركب على أي عربية من عربياتك', 'Not listed as fitting any of your cars')}
          </p>
          <p className="mt-1 text-sm leading-6 text-amber-900/80">
            {tr('اسأل البياع قبل ما تشتري، وقارن رقم القطعة باللي في عربيتك.', 'Ask the seller before you buy, and compare the part number with yours.')}
          </p>
        </div>
      </div>
    </div>
  );
}
