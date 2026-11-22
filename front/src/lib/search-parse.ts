import { fold, key, phrasesOf, saidAt } from './listing-parse';
import type { CarBrand, Condition } from './types';

/** A car a search names: a make, maybe a model, maybe a year. */
export interface SearchCar {
  brandId: string;
  modelId: string | null;
  year: number | null;
}

/** What someone typed in the search box, split into the words to find and the filters it names. */
export interface ReadSearch {
  /** The words left to look for in parts' names ("مارش"); empty when the search was only a car or a condition. */
  q: string;
  cars: SearchCar[];
  condition: Condition | null;
  origin: 'ORIGINAL' | 'AFTERMARKET' | null;
}

const CONDITION: Record<string, Condition> = {
  جديد: 'NEW', جديده: 'NEW', زيرو: 'NEW', new: 'NEW',
  مستعمل: 'USED', مستعمله: 'USED', used: 'USED',
  استيراد: 'IMPORTED', مستورد: 'IMPORTED', مستورده: 'IMPORTED', imported: 'IMPORTED',
};
const ORIGIN: Record<string, 'ORIGINAL' | 'AFTERMARKET'> = {
  اصلي: 'ORIGINAL', اصليه: 'ORIGINAL', original: 'ORIGINAL', وكاله: 'ORIGINAL', genuine: 'ORIGINAL', oem: 'ORIGINAL',
  تجاري: 'AFTERMARKET', تجاريه: 'AFTERMARKET', كوبي: 'AFTERMARKET', aftermarket: 'AFTERMARKET',
};
/** Small words around a car or year that mean nothing on their own: "لـ كورولا", "موديل 2016". */
const LINKS = /^(ل|لـ|لل|موديل|موديلات|سنه|عربيه|على|علي|for|model)$/;
const isYear = (word: string) => /^\d{4}$/.test(word) && Number(word) >= 1950 && Number(word) <= new Date().getFullYear() + 1;

/**
 * "مارش كورولا 2016 مستعمل" → look for "مارش", for a Toyota Corolla 2016,
 * used. Makes and models are found by their Arabic or English names (or
 * the usual misspellings), a year goes to the car before it, and whatever
 * is not understood stays as words to look for.
 */
export function readSearch(text: string, brands: CarBrand[]): ReadSearch {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const tokens = words.map((word) => (/^\d+$/.test(fold(word)) ? fold(word) : key(word) || fold(word)));
  const used = new Set<number>();
  const { makes, models } = phrasesOf(brands);
  const cars: (SearchCar & { end: number })[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const make = makes.find((p) => saidAt(tokens, i, p.words));
    if (make) {
      let end = i + make.words.length;
      let modelId: string | null = null;
      const next = models.find((p) => p.brand === make.brand && saidAt(tokens, end, p.words));
      if (next) {
        modelId = next.model!.id;
        end += next.words.length;
      }
      cars.push({ brandId: make.brand.id, modelId, year: null, end });
      for (let j = i; j < end; j++) used.add(j);
      i = end - 1;
      continue;
    }
    // A model on its own ("كورولا"), when it belongs to one make only.
    if (/^\d+$/.test(tokens[i]!) || tokens[i]!.length < 3) continue;
    const matches = models.filter((p) => saidAt(tokens, i, p.words));
    if (matches.length && new Set(matches.map((p) => p.brand.id)).size === 1) {
      const found = matches[0]!;
      cars.push({ brandId: found.brand.id, modelId: found.model!.id, year: null, end: i + found.words.length });
      for (let j = i; j < i + found.words.length; j++) used.add(j);
      i += found.words.length - 1;
    }
  }

  // Years: each to the car just before it, or the only car said.
  tokens.forEach((token, i) => {
    if (used.has(i) || !isYear(token)) return;
    const car = [...cars].reverse().find((c) => c.end <= i && c.year === null && c.modelId) ?? (cars.length === 1 && cars[0]!.modelId ? cars[0] : undefined);
    if (car && car.year === null) {
      car.year = Number(token);
      used.add(i);
    }
  });

  let condition: Condition | null = null;
  let origin: ReadSearch['origin'] = null;
  tokens.forEach((token, i) => {
    if (used.has(i)) return;
    if (CONDITION[token] && (!condition || CONDITION[token] === 'IMPORTED')) {
      condition = CONDITION[token]!;
      used.add(i);
    } else if (ORIGIN[token]) {
      origin = ORIGIN[token]!;
      used.add(i);
    }
  });
  // "لـ"/"موديل" left beside what was taken out go too.
  if (used.size) tokens.forEach((token, i) => LINKS.test(token) && used.add(i));

  return {
    q: words.filter((_, i) => !used.has(i)).join(' '),
    cars: cars.map(({ brandId, modelId, year }) => ({ brandId, modelId, year })),
    condition,
    origin,
  };
}

/** The `cars` search parameter for searched cars: "toyota:corolla:2016", "toyota:corolla:", "toyota::". */
export const searchCarsParam = (cars: SearchCar[]) => cars.map((c) => `${c.brandId}:${c.modelId ?? ''}:${c.year ?? ''}`).join(',') || undefined;

/** The search page's address for what was typed. */
export function searchUrl(read: ReadSearch): string {
  const params = new URLSearchParams();
  if (read.q) params.set('q', read.q);
  const cars = searchCarsParam(read.cars);
  if (cars) params.set('cars', cars);
  if (read.condition) params.set('condition', read.condition);
  if (read.origin) params.set('origin', read.origin);
  const query = params.toString();
  return query ? `/search?${query}` : '/search';
}
