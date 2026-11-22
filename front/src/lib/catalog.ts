import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import bundledCars from '@/data/car-catalog.json';
import governorateCities from '@/data/governorate-cities.json';
import governorateList from '@/data/governorates.json';

import { get } from './api';
import { useI18n } from './i18n';
import type { AppConfig, CarBrand, Category, Condition, Fitment, GarageCar, ReportReason } from './types';

export const CATEGORIES: { id: Category; ar: string; en: string }[] = [
  { id: 'ENGINE', ar: 'المحرك', en: 'Engine' },
  { id: 'BRAKES', ar: 'الفرامل', en: 'Brakes' },
  { id: 'SUSPENSION', ar: 'العفشة', en: 'Suspension' },
  { id: 'ELECTRICAL', ar: 'الكهرباء', en: 'Electrical' },
  { id: 'BODY', ar: 'الصاج والبودي', en: 'Body' },
  { id: 'LIGHTS', ar: 'الفوانيس', en: 'Lights' },
  { id: 'FILTERS', ar: 'الفلاتر والزيوت', en: 'Filters & oils' },
  { id: 'TYRES', ar: 'الكاوتش والجنوط', en: 'Tyres & rims' },
];

export const CONDITIONS: { id: Condition; ar: string; en: string }[] = [
  { id: 'NEW', ar: 'جديد', en: 'New' },
  { id: 'USED', ar: 'مستعمل', en: 'Used' },
  { id: 'IMPORTED', ar: 'استيراد', en: 'Imported' },
];

export const GOVERNORATES: string[] = governorateList;

/** Each governorate's main cities and districts, so people find theirs by the name they know ("طنطا" → الغربية). */
export const GOVERNORATE_CITIES: Record<string, string[]> = governorateCities;

/** The governorates as picker choices, found by their cities too. */
export const governorateOptions = (label: (name: string) => string) =>
  GOVERNORATES.map((g) => ({ value: g, label: label(g), keywords: GOVERNORATE_CITIES[g] ?? [] }));

export const GOVERNORATES_EN: Record<string, string> = {
  القاهرة: 'Cairo',
  الجيزة: 'Giza',
  الإسكندرية: 'Alexandria',
  القليوبية: 'Qalyubia',
  الدقهلية: 'Dakahlia',
  الشرقية: 'Sharqia',
  الغربية: 'Gharbia',
  المنوفية: 'Monufia',
  البحيرة: 'Beheira',
  'كفر الشيخ': 'Kafr El Sheikh',
  دمياط: 'Damietta',
  بورسعيد: 'Port Said',
  الإسماعيلية: 'Ismailia',
  السويس: 'Suez',
  الفيوم: 'Faiyum',
  'بني سويف': 'Beni Suef',
  المنيا: 'Minya',
  أسيوط: 'Asyut',
  سوهاج: 'Sohag',
  قنا: 'Qena',
  الأقصر: 'Luxor',
  أسوان: 'Aswan',
  'البحر الأحمر': 'Red Sea',
  'الوادي الجديد': 'New Valley',
  مطروح: 'Matrouh',
  'شمال سيناء': 'North Sinai',
  'جنوب سيناء': 'South Sinai',
};

export const REPORT_REASONS: {
  id: ReportReason;
  ar: string;
  en: string;
  targets: ('PART' | 'SELLER')[];
}[] = [
  { id: 'FAKE', ar: 'إعلان وهمي', en: 'Fake listing', targets: ['PART'] },
  { id: 'WRONG_INFO', ar: 'بيانات غلط', en: 'Wrong details', targets: ['PART'] },
  { id: 'COUNTERFEIT', ar: 'قطعة مقلدة على إنها أصلي', en: 'Counterfeit sold as original', targets: ['PART'] },
  { id: 'STOLEN', ar: 'قطعة مسروقة', en: 'Stolen part', targets: ['PART'] },
  { id: 'UNREACHABLE', ar: 'مش بيرد', en: "Doesn't answer", targets: ['SELLER'] },
  { id: 'ABUSIVE', ar: 'أسلوب مسيء', en: 'Abusive', targets: ['SELLER'] },
  { id: 'SCAM', ar: 'نصب', en: 'Scam', targets: ['PART', 'SELLER'] },
  { id: 'OTHER', ar: 'سبب تاني', en: 'Something else', targets: ['PART', 'SELLER'] },
];

/** `/app-config`: support, documents, cars, banner, offers. Cached by the server for 5 min. */
export function useAppConfig() {
  return useQuery({
    queryKey: ['app-config'],
    queryFn: () => get<AppConfig>('/app-config'),
    staleTime: 5 * 60_000,
  });
}

/** The make id for a make typed by hand; its name is in `brandName`. */
export const OTHER_BRAND = 'other';
/** Year lists start here, even for models the list has from a later year. */
export const LIST_FROM_YEAR = 1998;
/** The oldest year anyone can type. */
export const OLDEST_YEAR = 1950;

/**
 * The car list the dashboard keeps (or the bundled one until it loads), makes
 * and each make's models in alphabetical order in the page's language.
 */
export function useCars(): CarBrand[] {
  const { data } = useAppConfig();
  const { lang } = useI18n();
  const list = data?.cars?.brands;
  const brands = list && list.length ? list : (bundledCars as CarBrand[]);
  return useMemo(() => {
    const name = (x: { nameAr: string; nameEn: string }) => (lang === 'ar' ? x.nameAr : x.nameEn);
    const byName = (a: { nameAr: string; nameEn: string }, b: { nameAr: string; nameEn: string }) =>
      name(a).localeCompare(name(b), lang === 'ar' ? 'ar' : 'en', { sensitivity: 'base', numeric: true });
    return [...brands].sort(byName).map((brand) => ({ ...brand, models: [...brand.models].sort(byName) }));
  }, [brands, lang]);
}

/**
 * The years offered for a model, newest first: from 1998 (or its first year,
 * if older) to its last, still-made meaning this year. A typed model: from
 * 1998 to next year. Older years are typed (down to [OLDEST_YEAR]).
 */
export function modelYears(model: { fromYear: number; toYear: number | null } | null): [number, number] {
  const now = new Date().getUTCFullYear();
  if (!model) return [LIST_FROM_YEAR, now + 1];
  return [Math.min(model.fromYear, LIST_FROM_YEAR), model.toYear ?? now];
}

/** The years between two, newest first. */
export const yearRange = ([first, last]: [number, number]) => Array.from({ length: last - first + 1 }, (_, i) => last - i);

/** A typed name reduced to what matches, like the server's: no case, spaces or letter-form differences. */
export const carKey = (name: string | null | undefined) =>
  (name ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]/gu, '');

/** One string per car, to tell two apart. */
export const carId = (c: GarageCar) =>
  `${c.brandId === OTHER_BRAND ? `~${carKey(c.brandName)}` : c.brandId}:${c.modelId ?? `~${carKey(c.modelName)}`}:${c.year}`;

/** Labels that follow the language. */
export function useLabels() {
  const { lang, pick } = useI18n();
  const brands = useCars();

  const category = useCallback(
    (id: Category) => {
      const c = CATEGORIES.find((x) => x.id === id);
      return c ? (lang === 'ar' ? c.ar : c.en) : id;
    },
    [lang],
  );
  const condition = useCallback(
    (id: Condition) => {
      const c = CONDITIONS.find((x) => x.id === id);
      return c ? (lang === 'ar' ? c.ar : c.en) : id;
    },
    [lang],
  );
  const city = useCallback(
    (name: string | null | undefined) =>
      !name ? '' : lang === 'ar' ? name : (GOVERNORATES_EN[name] ?? name),
    [lang],
  );
  /** A make's name; a typed make shows what was typed. */
  const brand = useCallback(
    (brandId: string, brandName?: string | null) => {
      if (brandId === OTHER_BRAND) return brandName || pick('ماركة تانية', 'Other make');
      const b = brands.find((x) => x.id === brandId);
      return b ? pick(b.nameAr, b.nameEn) : brandId;
    },
    [brands, pick],
  );
  /** A model's name; a typed model shows what was typed. */
  const model = useCallback(
    (brandId: string, modelId: string | null, modelName?: string | null) => {
      if (!modelId) return modelName ?? '';
      const m = brands.find((x) => x.id === brandId)?.models.find((x) => x.id === modelId);
      return m ? pick(m.nameAr, m.nameEn) : modelId;
    },
    [brands, pick],
  );
  /** "تويوتا كورولا", typed names as typed. */
  const carName = useCallback(
    (c: { brandId: string; brandName?: string | null; modelId: string | null; modelName?: string | null }) =>
      `${brand(c.brandId, c.brandName)} ${model(c.brandId, c.modelId, c.modelName)}`.trim(),
    [brand, model],
  );
  const car = useCallback((c: GarageCar) => (c.year ? `${carName(c)} ${c.year}` : carName(c)), [carName]);
  /** "تويوتا كورولا 2014–2020", "تويوتا كراون", or "تويوتا (كل الموديلات)" for a whole make. */
  const fitment = useCallback(
    (f: Fitment) => {
      const years = f.fromYear && f.toYear ? ` ${f.fromYear === f.toYear ? f.fromYear : `${f.fromYear}–${f.toYear}`}` : '';
      if (f.modelId || f.modelName) return `${carName(f)}${years}`;
      return `${brand(f.brandId, f.brandName)} (${pick('كل الموديلات', 'all models')})`;
    },
    [brand, carName, pick],
  );
  return { category, condition, city, brand, model, carName, car, fitment, brands };
}

// public/brands/<id>.webp (96px, from the .png by scripts/optimize-assets.mjs), from github.com/filippofilip95/car-logos-dataset
// (commit e334a4d). Makes it has no logo for show their initial.
const NO_LOGO = new Set(['dfsk', OTHER_BRAND]);

/** A make's logo, or null to show its initial instead. */
export function brandLogo(brandId: string): string | null {
  return NO_LOGO.has(brandId) ? null : `/brands/${brandId}.webp`;
}

/**
 * The `cars` search parameter: `toyota:corolla:2016`, a typed make or model as
 * its name after `~` (`toyota:~كراون:1999`). Separators are kept out of names.
 */
const paramName = (name: string | null | undefined) => (name ?? '').replace(/[:,~]/g, ' ').trim();
export const carsParam = (cars: GarageCar[]) =>
  cars
    .map((c) => `${c.brandId === OTHER_BRAND ? `~${paramName(c.brandName)}` : c.brandId}:${c.modelId ?? `~${paramName(c.modelName)}`}:${c.year}`)
    .join(',') || undefined;

/** The cars in a `cars` search parameter. */
export const parseCarsParam = (value: string): GarageCar[] =>
  value
    .split(',')
    .filter(Boolean)
    .map((item) => {
      const [brand = '', model = '', year] = item.split(':');
      return {
        brandId: brand.startsWith('~') ? OTHER_BRAND : brand,
        brandName: brand.startsWith('~') ? brand.slice(1) : null,
        modelId: model.startsWith('~') || !model ? null : model,
        modelName: model.startsWith('~') ? model.slice(1) : null,
        // 0: any year (a searched model without one).
        year: Number(year) || 0,
      };
    });
