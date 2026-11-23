import cars from './car-catalog.json' with { type: 'json' };
import governorates from './governorates.json' with { type: 'json' };

/**
 * Car makes and models and Egypt's governorates. The cars start as the
 * list in `car-catalog.json` (the one the app ships with); owners edit them
 * from the dashboard, and [setCarBrands] puts the saved list in use.
 */
export type CarModel = {
  id: string;
  nameAr: string;
  nameEn: string;
  fromYear: number;
  toYear: number | null;
};
export type CarBrand = { id: string; nameAr: string; nameEn: string; models: CarModel[] };

/** The launch list, used until an owner saves one. */
export const DEFAULT_CAR_BRANDS = cars as CarBrand[];

let brands: CarBrand[] = DEFAULT_CAR_BRANDS;

/** The cars parts are listed for and searched by. */
export function carBrands(): CarBrand[] {
  return brands;
}

/** Puts [list] in use, or the launch list when null. */
export function setCarBrands(list: CarBrand[] | null): void {
  brands = list?.length ? list : DEFAULT_CAR_BRANDS;
}
const cities = new Set(governorates as string[]);

export const PART_CATEGORIES = [
  'ENGINE',
  'BRAKES',
  'SUSPENSION',
  'ELECTRICAL',
  'BODY',
  'LIGHTS',
  'FILTERS',
  'TYRES',
] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

export const PART_CONDITIONS = ['NEW', 'USED', 'IMPORTED'] as const;
export type PartCondition = (typeof PART_CONDITIONS)[number];

export function findBrand(id: string): CarBrand | undefined {
  return brands.find((brand) => brand.id === id);
}

export function findModel(brandId: string, modelId: string): CarModel | undefined {
  return findBrand(brandId)?.models.find((model) => model.id === modelId);
}

/** First and last year the model was made; still made means this year. */
export function modelYears(model: CarModel, now = new Date()): [number, number] {
  return [model.fromYear, model.toYear ?? now.getUTCFullYear()];
}

export function isGovernorate(city: string): boolean {
  return cities.has(city);
}

/**
 * The governorate a search's words name, normalised, with or without "ال"
 * ("اسكندريه", "الاسكندريه", "كفر الشيخ"), keyed to its name as stored.
 */
const governorateWords: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const city of cities) {
    const n = normalizeSearchText(city);
    // Also run together: "بور سعيد" and "بورسعيد".
    for (const form of [n, n.replace(/\s+/g, '')]) {
      map.set(form, city);
      if (form.startsWith('ال')) map.set(form.slice(2), city);
    }
  }
  return map;
})();

export function governorateOf(words: string): string | undefined {
  return governorateWords.get(words);
}

/**
 * A search word that names a whole category ("فرامل", "عفشه") also finds the
 * parts listed in it, whatever their names. Only the broad words: "فلتر",
 * "موتور" or "كاوتش" mean that very part, not everything near it.
 */
const CATEGORY_WORDS: Record<string, PartCategory> = {
  فرامل: 'BRAKES', فرامله: 'BRAKES', الفرامل: 'BRAKES', brakes: 'BRAKES', brake: 'BRAKES',
  عفشه: 'SUSPENSION', العفشه: 'SUSPENSION', suspension: 'SUSPENSION',
  كهربا: 'ELECTRICAL', كهرباء: 'ELECTRICAL', الكهربا: 'ELECTRICAL', الكهرباء: 'ELECTRICAL', electrical: 'ELECTRICAL',
  صاج: 'BODY', الصاج: 'BODY', بودي: 'BODY', البودي: 'BODY', body: 'BODY', سمكره: 'BODY',
  اضاءه: 'LIGHTS', الاضاءه: 'LIGHTS', انوار: 'LIGHTS', الانوار: 'LIGHTS', lights: 'LIGHTS', lighting: 'LIGHTS',
};

export function categoryOfWord(word: string): PartCategory | undefined {
  return CATEGORY_WORDS[word];
}

/**
 * Lower-case, without Arabic diacritics, with the letter forms people type
 * interchangeably made the same (أ إ آ → ا, ة → ه, ى → ي) and without the
 * dashes in part numbers. Matches `normalizeSearchText` in the app.
 */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[-_/]/g, '')
    .trim();
}

/**
 * Everything a part is found by, normalised: its name, number and cars.
 * Not the category's name: oils are in "الفلاتر والزيوت", and "فلتر" would
 * bring every oil (a broad category word in a search matches the category
 * instead, see [categoryOfWord]). Not the governorate: "شمال" (left) would
 * bring everything in شمال سيناء (a governorate in a search is a filter).
 * Not the seller's name: a shop called "سنتر موبيل" would come up, with all
 * its parts, for "موبيل" (shops have their own search).
 */
/**
 * Engine oil is often listed by brand and grade only ("Total 5000 4L",
 * "Shell اصفر 5000"): in the oils category, a grade, litres or an oil brand
 * in the name, and not coolant, it is found by "زيت" too.
 */
const OIL_SIGNS = /\d+\s*w\s*-?\d+|\d\s*l(?![a-z])|لتر|shell|total|mobil|castrol|valvoline|motul|petronas|شل|توتال|موبيل|كاسترول|فالفولين|موتول/i;
const NOT_OIL = /مياه|مية|water|coolant|تبريد|فلتر|filter/i;
function looksLikeOil(part: { name: string; category: PartCategory }): boolean {
  return part.category === 'FILTERS' && OIL_SIGNS.test(part.name) && !NOT_OIL.test(part.name);
}

export function searchableText(part: {
  name: string;
  partNumber?: string | null;
  category: PartCategory;
  city: string;
  sellerName?: string;
  fitments: { brandId: string; modelId?: string | null; brandName?: string | null; modelName?: string | null }[];
}): string {
  const words = [part.name, part.partNumber ?? ''];
  if (looksLikeOil(part)) words.push('زيت oil');
  for (const fitment of part.fitments) {
    const brand = findBrand(fitment.brandId);
    const model = fitment.modelId ? findModel(fitment.brandId, fitment.modelId) : undefined;
    words.push(brand?.nameAr ?? '', brand?.nameEn ?? '', model?.nameAr ?? '', model?.nameEn ?? '', fitment.brandName ?? '', fitment.modelName ?? '');
  }
  return normalizeSearchText(words.join(' '));
}
