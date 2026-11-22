import type { CarBrand, Category, Condition, Fitment } from './types';

/**
 * Reads a part a seller said out loud ("مارش تويوتا كورولا من 2014 لـ 2018
 * مستعمل أصلي بـ 1800 جنيه") into the selling form's fields, in the browser,
 * for free. Built for the way sellers usually say it: the part first, then
 * the cars, condition and price. Claude, when the server has it, does better
 * with free-flowing speech.
 */

export interface ParsedListing {
  name: string | null;
  category: Category | null;
  condition: Condition | null;
  isOriginal: boolean | null;
  partNumber: string | null;
  price: number | null;
  description: string | null;
  fitsAllCars: boolean;
  fitments: Fitment[];
}

/** Letters folded the way speech-to-text and people spell them differently. */
export const fold = (text: string) =>
  text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase();
export const key = (text: string) => fold(text).replace(/[^\p{L}\p{N}]/gu, '');

// ---- Numbers said as words ("ألف وتمنمية" = 1800) ----

const UNITS: Record<string, number> = {
  واحد: 1, اتنين: 2, اثنين: 2, تلاته: 3, ثلاثه: 3, تلات: 3, ثلاث: 3, اربعه: 4, اربع: 4, خمسه: 5, خمس: 5, سته: 6, ست: 6, سبعه: 7, سبع: 7,
  تمانيه: 8, ثمانيه: 8, تمن: 8, تسعه: 9, تسع: 9, عشره: 10, عشر: 10,
  حداشر: 11, اتناشر: 12, تلتاشر: 13, اربعتاشر: 14, خمستاشر: 15, ستاشر: 16, سبعتاشر: 17, تمنتاشر: 18, تسعتاشر: 19,
  عشرين: 20, تلاتين: 30, ثلاثين: 30, اربعين: 40, خمسين: 50, ستين: 60, سبعين: 70, تمانين: 80, ثمانين: 80, تسعين: 90,
  ميه: 100, مايه: 100, مائه: 100, ميت: 100, ميتين: 200, مائتين: 200, تلتميه: 300, ثلاثمائه: 300, ربعميه: 400, اربعمائه: 400,
  تلاتميه: 300, اربعميه: 400, تمانميه: 800, ستمايه: 600, سبعمايه: 700,
  خمسميه: 500, خمسمائه: 500, ستميه: 600, ستمائه: 600, سبعميه: 700, سبعمائه: 700, تمنميه: 800, ثمانمائه: 800, تسعميه: 900, تسعمائه: 900,
};
const THOUSAND = new Set(['الف', 'الاف', 'تلاف', 'thousand', 'k']);
const TWO_THOUSAND = new Set(['الفين', 'الفان']);

/** A number word, or a number written in digits; a leading "و" (and) dropped. */
function numberWord(word: string): { value: number; kind: 'n' | 'thousand' | 'two-thousand' } | null {
  const w = word.startsWith('و') && word.length > 2 && !/^\d/.test(word) ? word.slice(1) : word;
  for (const candidate of [w, word]) {
    if (/^\d+([.,]\d+)?$/.test(candidate)) return { value: Number(candidate.replace(',', '.')), kind: 'n' };
    if (candidate in UNITS) return { value: UNITS[candidate]!, kind: 'n' };
    if (THOUSAND.has(candidate)) return { value: 1000, kind: 'thousand' };
    if (TWO_THOUSAND.has(candidate)) return { value: 2000, kind: 'two-thousand' };
  }
  return null;
}

/** The number starting at [words][at] ("1800", "الف وتمنميه", "2 الف", "الف و 800"), and how many words it took. */
function readNumber(words: string[], at: number): { value: number; used: number } | null {
  let total = 0;
  let current = 0;
  let used = 0;
  for (let i = at; i < words.length; i++) {
    const n = numberWord(words[i]!);
    if (!n) {
      if (words[i] === 'و' && used > 0) {
        used++;
        continue;
      }
      break;
    }
    if (n.kind === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
    } else if (n.kind === 'two-thousand') {
      total += 2000;
    } else {
      current += n.value;
    }
    used = i - at + 1;
  }
  if (used === 0) return null;
  return { value: Math.round(total + current), used };
}

// ---- The words that mean something to the form ----

const CONDITIONS: [RegExp, Condition][] = [
  [/^(استيراد|مستورد|مستورده|وارد|imported)$/, 'IMPORTED'],
  [/^(مستعمل|مستعمله|استعمال|used|كسر)$/, 'USED'],
  [/^(جديد|جديده|زيرو|new)$/, 'NEW'],
];
const ORIGINAL = /^(اصلي|اصليه|اوريجينال|original|وكاله|الوكاله|genuine)$/;
const AFTERMARKET = /^(تجاري|تجاريه|كوبي|تقليد|صيني|aftermarket)$/;
const EVERY_CAR = /(كل|اي|جميع) (العربيات|عربيه|السيارات|سياره|الانواع|انواع العربيات|الموديلات)/;
const PRICE_CUE = /^(بسعر|السعر|سعرها|سعره|بالسعر|سعر|ب|بـ)$/;
const CURRENCY = /^(جنيه|جنيها|جنيهات|جنية|ج|جم|pound|pounds|le|egp)$/;
const YEAR_CUE = /^(موديل|موديلات|سنه|من)$/;
const RANGE_TO = /^(ل|لـ|لل|الى|لحد|لغايه|حتي|to|-)$/;
const FILLER = /^(عندي|معايا|معاي|عايز|ابيع|للبيع|بيع|قطعه|في|يا|بص|دي|ده|هي|هو|انا)$/;
const FITS = /^(يركب|تركب|بتركب|بيركب|ل|لـ|على|علي|لعربيه|للعربيات|عربيه|for)$/;
/** A number followed by one of these is part of the name ("جنوط 16 بوصه", "بطاريه 70 امبير"). */
const UNIT = /^(بوصه|انش|امبير|سم|مم|ملي|لتر|cc|سي|وات|فولت|v|a|mm|ton|طن)$/;

/** Category from the part's name: the first word that gives it away. */
const CATEGORY_WORDS: [RegExp, Category][] = [
  [/^(مارش|دينامو|بطاريه|حساس|سنسور|كويل|فيوز|ضفيره|كمبيوتر|ريليه|كهربا|كهرباء|بوبينه|سلف|منظم)/, 'ELECTRICAL'],
  [/^(تيل|فرامل|فرامله|طنبوره|ديسك|اسطوانه|سلندر|خرطوم فرامل)/, 'BRAKES'],
  [/^(مساعد|مساعدين|مقص|مقصات|جلبه|جلب|عفشه|كبالن|بلي|بليه|دريكسيون|ركبه|بارات|بار|ميزان|عمود)/, 'SUSPENSION'],
  [/^(فانوس|فوانيس|كشاف|كشافات|اسطب|لمبه|لمبات|اضاءه|ليد)/, 'LIGHTS'],
  [/^(باب|ابواب|اكصدام|اكسدام|صدام|كبوت|رفرف|مرايه|مرايات|زجاج|ازاز|شنطه|سقف|شبكه|كبوت)/, 'BODY'],
  [/^(فلتر|فلاتر|زيت|زيوت)/, 'FILTERS'],
  [/^(كاوتش|كاوتشات|اطار|اطارات|جنط|جنوط|كفر)/, 'TYRES'],
  [/^(موتور|مكنه|طلمبه|ردياتير|رداتير|مروحه|سير|كاتينه|جوان|بستم|كرنك|تيربو|ترموستات|ثرموستات|كمبروسر|تكييف|مكيف|بوجيه|شكمان|علبه)/, 'ENGINE'],
];

/** Common ways makes are said that the list doesn't spell. */
const MAKE_ALIASES: Record<string, string[]> = {
  chevrolet: ['شفروليه', 'شيفروليت', 'شفروليت', 'شيفورليه'],
  hyundai: ['هيونداى', 'هيوندا', 'هيونداي'],
  'mercedes-benz': ['مرسيدس', 'مارسيدس', 'بنز', 'mercedes'],
  volkswagen: ['فولكس', 'فلوكس', 'vw'],
  mitsubishi: ['متسوبيشي', 'ميتسوبيشى'],
  bmw: ['بي ام', 'بيام', 'بي ام دبليو', 'بي ام دابليو'],
  toyota: ['تيوتا'],
  'land-rover': ['لاند روفر', 'رينج روفر', 'رنج'],
};
const MODEL_ALIASES: Record<string, string[]> = { sunny: ['صني', 'سني'], lanos: ['لانوس'], verna: ['فرنا'] };

type Phrase = { words: string[]; brand: CarBrand; model: CarBrand['models'][number] | null };

/** Every way to say each make and model, as word lists of folded keys. */
export function phrasesOf(brands: CarBrand[]): { makes: Phrase[]; models: Phrase[] } {
  const words = (name: string) => fold(name).split(/[\s\-]+/).map(key).filter(Boolean);
  const makes: Phrase[] = [];
  const models: Phrase[] = [];
  for (const brand of brands) {
    for (const name of new Set([brand.nameAr, brand.nameEn, brand.id.replace(/-/g, ' '), ...(MAKE_ALIASES[brand.id] ?? [])])) {
      makes.push({ words: words(name), brand, model: null });
    }
    for (const model of brand.models) {
      for (const name of new Set([model.nameAr, model.nameEn, model.id.replace(/-/g, ' '), ...(MODEL_ALIASES[model.id] ?? [])])) {
        models.push({ words: words(name), brand, model });
      }
    }
  }
  // Longer names first, so "لاند روفر" wins over a one-word match.
  const longestFirst = (a: Phrase, b: Phrase) => b.words.length - a.words.length;
  return { makes: makes.sort(longestFirst), models: models.sort(longestFirst) };
}

/** Whether [phrase] is said at [at], allowing "ل"/"ب"/"و" stuck to the first word ("لتويوتا"). */
export function saidAt(tokens: string[], at: number, phrase: string[]): boolean {
  if (phrase.length === 0 || at + phrase.length > tokens.length) return false;
  return phrase.every((word, i) => {
    const token = tokens[at + i]!;
    if (token === word) return true;
    return i === 0 && /^[لبو]/.test(token) && token.slice(1) === word;
  });
}

const thisYear = () => new Date().getFullYear();
const isYear = (n: number) => Number.isInteger(n) && n >= 1950 && n <= thisYear() + 1;

export function parseSpokenListing(text: string, brands: CarBrand[]): ParsedListing {
  const original = text.replace(/\s+/g, ' ').trim();
  // Words, with "لـ2018" split into "لـ" and "2018", and "1800ج" into "1800" and "ج".
  const raw = fold(original)
    .replace(/([لب])ـ?(\d)/g, '$1 $2')
    .replace(/(\d)([^\d\s.,])/g, '$1 $2')
    .replace(/[،,؛;:!?()"]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const tokens = raw.map((word) => (/^[\d.]+$/.test(word) ? word : key(word) || word));
  const originalWords = original.split(' ');
  const taken = new Set<number>();
  const take = (from: number, count: number) => {
    for (let i = from; i < from + count; i++) taken.add(i);
  };

  // Cars: a make (maybe followed by a model), or a model on its own.
  const { makes, models } = phrasesOf(brands);
  type Found = { at: number; end: number; brand: CarBrand; model: CarBrand['models'][number] | null; fromYear: number | null; toYear: number | null };
  const cars: Found[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const make = makes.find((p) => saidAt(tokens, i, p.words));
    if (make) {
      let end = i + make.words.length;
      let model: Found['model'] = null;
      for (let j = end; j < Math.min(tokens.length, end + 2) && !model; j++) {
        const found = models.find((p) => p.brand === make.brand && saidAt(tokens, j, p.words));
        if (found) {
          model = found.model;
          end = j + found.words.length;
        }
      }
      cars.push({ at: i, end, brand: make.brand, model, fromYear: null, toYear: null });
      take(i, end - i);
      i = end - 1;
      continue;
    }
    // A model alone ("كورولا"), if it belongs to one make only and isn't just a number.
    if (/^\d+$/.test(tokens[i]!)) continue;
    const matches = models.filter((p) => saidAt(tokens, i, p.words));
    const brandsMatched = new Set(matches.map((p) => p.brand.id));
    if (matches.length && brandsMatched.size === 1 && tokens[i]!.length >= 3) {
      const found = matches[0]!;
      cars.push({ at: i, end: i + found.words.length, brand: found.brand, model: found.model, fromYear: null, toYear: null });
      take(i, found.words.length);
      i += found.words.length - 1;
    }
  }

  // Years: "من 2014 لـ 2018", "2014 - 2018", "موديل 2016", or a year right after a car.
  const yearRanges: { at: number; from: number; to: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (taken.has(i)) continue;
    const n = /^\d{4}$/.test(tokens[i]!) ? Number(tokens[i]) : NaN;
    if (!isYear(n)) continue;
    const afterTo = RANGE_TO.test(tokens[i + 1] ?? '') ? i + 2 : -1;
    const second = afterTo > 0 && /^\d{2,4}$/.test(tokens[afterTo] ?? '') ? Number(tokens[afterTo]) : NaN;
    const to = second < 100 ? 2000 + second : second;
    const cueBefore = YEAR_CUE.test(tokens[i - 1] ?? '');
    const afterCar = cars.some((car) => car.end === i || car.end === i - 1);
    if (isYear(to)) {
      yearRanges.push({ at: i, from: Math.min(n, to), to: Math.max(n, to) });
      take(i, afterTo - i + 1);
      if (cueBefore) taken.add(i - 1);
      i = afterTo;
    } else if (cueBefore || afterCar) {
      yearRanges.push({ at: i, from: n, to: n });
      taken.add(i);
      if (cueBefore) taken.add(i - 1);
    }
  }
  // Each range goes to the car said just before it (or the next one, if none before).
  for (const range of yearRanges) {
    const before = [...cars].reverse().find((car) => car.at < range.at && car.fromYear === null);
    const car = before ?? cars.find((c) => c.fromYear === null);
    if (car) {
      car.fromYear = range.from;
      car.toYear = range.to;
    }
  }

  // Price: after a cue ("بـ 1800", "بسعر الف وتمنميه"), before a currency ("1800 جنيه"), or a number left over.
  let price: number | null = null;
  for (let i = 0; i < tokens.length && price === null; i++) {
    if (taken.has(i)) continue;
    const cue = PRICE_CUE.test(tokens[i]!);
    // "بالف" / "بتلاتميه": the cue stuck to the number word.
    const stuck = !cue && tokens[i]!.startsWith('ب') ? readNumber([tokens[i]!.slice(1), ...tokens.slice(i + 1)], 0) : null;
    if (stuck && !numberWord(tokens[i]!)) {
      price = stuck.value;
      take(i, stuck.used);
      if (CURRENCY.test(tokens[i + stuck.used] ?? '')) taken.add(i + stuck.used);
      break;
    }
    if (cue) {
      const n = readNumber(tokens, i + 1);
      if (n) {
        price = n.value;
        take(i, n.used + 1);
        if (CURRENCY.test(tokens[i + 1 + n.used] ?? '')) taken.add(i + 1 + n.used);
      }
      continue;
    }
    const n = readNumber(tokens, i);
    if (n && CURRENCY.test(tokens[i + n.used] ?? '')) {
      price = n.value;
      take(i, n.used + 1);
    }
  }
  if (price === null) {
    for (let i = 0; i < tokens.length && price === null; i++) {
      if (taken.has(i)) continue;
      const n = readNumber(tokens, i);
      if (UNIT.test(tokens[i + (n?.used ?? 1)] ?? '')) continue;
      if (n && n.value >= 10 && !(n.used === 1 && isYear(n.value) && /^\d{4}$/.test(tokens[i]!) && cars.length > 0)) {
        price = n.value;
        take(i, n.used);
      }
    }
  }
  if (price !== null && (price < 1 || price > 10_000_000)) price = null;

  // Condition, original or not, every car.
  let condition: Condition | null = null;
  let isOriginal: boolean | null = null;
  tokens.forEach((token, i) => {
    for (const [pattern, value] of CONDITIONS) {
      // "مستعمل استيراد" is imported; otherwise the first said wins.
      if (pattern.test(token) && (condition === null || value === 'IMPORTED')) {
        condition = value;
        taken.add(i);
      }
    }
    if (ORIGINAL.test(token)) {
      isOriginal = true;
      taken.add(i);
    } else if (AFTERMARKET.test(token)) {
      isOriginal = false;
      taken.add(i);
    }
  });
  const fitsAllCars = EVERY_CAR.test(raw.join(' '));

  // A warranty is worth telling the buyer: "بضمان شهر", "ضمان 3 شهور".
  const warrantyMatch = original.match(/(ب?ضمان|warranty)\s+(\S+)(?:\s+(\S+))?/i);
  const warranty = warrantyMatch
    ? [warrantyMatch[1], warrantyMatch[2], warrantyMatch[3] && !PRICE_CUE.test(key(warrantyMatch[3])) && !numberWord(key(warrantyMatch[3])) && /^\d/.test(warrantyMatch[2] ?? '') ? warrantyMatch[3] : null]
        .filter(Boolean)
        .join(' ')
    : null;

  // Name: the words before the first car, condition, price or year, without fillers.
  const stopAt = tokens.findIndex(
    (token, i) => taken.has(i) || FITS.test(token) || (/^\d/.test(token) && !UNIT.test(tokens[i + 1] ?? '')) || /ضمان/.test(token),
  );
  const nameWords = originalWords
    .slice(0, stopAt === -1 ? originalWords.length : stopAt)
    .filter((word) => !FILLER.test(key(word)));
  const name = nameWords.slice(0, 6).join(' ').trim() || null;

  const nameKeys = (name ? fold(name) : '').split(/\s+/).map(key);
  const everything = tokens;
  const category =
    CATEGORY_WORDS.find(([pattern]) => nameKeys.some((word) => pattern.test(word)))?.[1] ??
    CATEGORY_WORDS.find(([pattern]) => everything.some((word) => pattern.test(word)))?.[1] ??
    null;

  // Each make once; a model's own entry beats a make alone.
  const fitments: Fitment[] = [];
  for (const car of cars) {
    const fitment: Fitment = {
      brandId: car.brand.id,
      brandName: null,
      modelId: car.model?.id ?? null,
      modelName: null,
      fromYear: car.model ? car.fromYear : null,
      toYear: car.model ? car.toYear : null,
    };
    if (!fitments.some((f) => f.brandId === fitment.brandId && f.modelId === fitment.modelId)) fitments.push(fitment);
  }

  return {
    name: name && name.length >= 2 ? name.slice(0, 100) : null,
    category,
    condition,
    isOriginal,
    partNumber: null,
    price,
    description: warranty,
    fitsAllCars: fitsAllCars && fitments.length === 0,
    fitments: fitsAllCars ? [] : fitments,
  };
}
