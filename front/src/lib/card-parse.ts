import { GOVERNORATE_CITIES, GOVERNORATES, GOVERNORATES_EN } from './catalog';
import { fromE164, toE164 } from './format';

/** One line of text read off a business card. */
export interface CardLine {
  text: string;
  /** Height of the line in pixels: a shop's name is usually the biggest text. */
  height: number;
  /** 0–100, how sure the reader is of the line. */
  confidence: number;
  /** Where it is in the photo, when known: pieces of one line are put back together by it. */
  box?: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * The reader, looking for scattered text, cuts some lines into pieces ("مؤسسة"
 * | "الفجر" | "لقطع الغيار"). Pieces side by side on one row, of about the same
 * size, become one line again: right to left for Arabic, left to right otherwise.
 */
export function joinRows<T extends CardLine>(lines: T[]): CardLine[] {
  const placed = lines.filter((line) => line.box);
  const rest: CardLine[] = lines.filter((line) => !line.box);
  const used = new Set<T>();
  const centre = (line: T) => (line.box!.y0 + line.box!.y1) / 2;
  for (const line of [...placed].sort((a, b) => b.height - a.height)) {
    if (used.has(line)) continue;
    used.add(line);
    const row = [line];
    // Grow the row with pieces level with any piece already in it (a photo
    // taken at a slight angle drifts along a long line), not overlapping it.
    for (let grew = true; grew; ) {
      grew = false;
      for (const other of placed) {
        if (used.has(other)) continue;
        const fits = row.some((piece) => {
          const tall = Math.max(piece.height, other.height);
          const ratio = other.height / piece.height;
          const level = Math.abs(centre(piece) - centre(other)) < tall * 0.45;
          const gap = Math.max(other.box!.x0 - piece.box!.x1, piece.box!.x0 - other.box!.x1);
          return level && ratio > 0.6 && ratio < 1.65 && gap > -tall * 0.2 && gap < tall * 2.5;
        });
        if (fits) {
          row.push(other);
          used.add(other);
          grew = true;
        }
      }
    }
    if (row.length === 1) {
      rest.push(line);
      continue;
    }
    const text = row.map((piece) => piece.text).join(' ');
    const rtl = (text.match(/[\u0621-\u064A]/g) ?? []).length >= (text.match(/[A-Za-z]/g) ?? []).length;
    row.sort((a, b) => (rtl ? b.box!.x1 - a.box!.x1 : a.box!.x0 - b.box!.x0));
    const letters = (piece: CardLine) => Math.max(1, piece.text.trim().length);
    rest.push({
      text: row.map((piece) => piece.text.trim()).join(' '),
      height: Math.max(...row.map((piece) => piece.height)),
      confidence: row.reduce((sum, piece) => sum + piece.confidence * letters(piece), 0) / row.reduce((sum, piece) => sum + letters(piece), 0),
      box: {
        x0: Math.min(...row.map((piece) => piece.box!.x0)),
        y0: Math.min(...row.map((piece) => piece.box!.y0)),
        x1: Math.max(...row.map((piece) => piece.box!.x1)),
        y1: Math.max(...row.map((piece) => piece.box!.y1)),
      },
    });
  }
  // Top to bottom, as on the card.
  return rest.sort((a, b) => (a.box ? a.box.y0 : 0) - (b.box ? b.box.y0 : 0));
}

/** What a business card says, for the shop sign-up form; null where it could not tell. */
export interface CardDetails {
  shopName: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Arabic-Indic and Persian digits to 0–9. */
export const westernDigits = (text: string) =>
  text.replace(/[٠-٩۰-۹]/g, (d) => String(ARABIC_DIGITS.includes(d) ? ARABIC_DIGITS.indexOf(d) : PERSIAN_DIGITS.indexOf(d)));

/** Spellings vary (أ/ا, ة/ه, ى/ي, tashkeel): compare on one form. */
export const foldArabic = (text: string) =>
  text
    .replace(/[ً-ْـ]/g, '') // tashkeel, tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();

/** Big cities and districts printed on cards instead of the governorate. */
const PLACES: Record<string, string> = {
  'مدينه نصر': 'القاهرة', 'مصر الجديده': 'القاهرة', 'المعادي': 'القاهرة', 'شبرا': 'القاهرة', 'حلوان': 'القاهرة',
  'العباسيه': 'القاهرة', 'التجمع': 'القاهرة', 'القاهره الجديده': 'القاهرة', 'عين شمس': 'القاهرة', 'المطريه': 'القاهرة',
  'الزيتون': 'القاهرة', 'السيده زينب': 'القاهرة', 'التوفيقيه': 'القاهرة', 'مدينه الشروق': 'القاهرة', 'مدينه بدر': 'القاهرة',
  'المهندسين': 'الجيزة', 'الدقي': 'الجيزة', 'الهرم': 'الجيزة', 'اكتوبر': 'الجيزة', 'الشيخ زايد': 'الجيزة',
  'امبابه': 'الجيزة', 'بولاق الدكرور': 'الجيزة',
  'سموحه': 'الإسكندرية', 'العجمي': 'الإسكندرية', 'المنتزه': 'الإسكندرية', 'برج العرب': 'الإسكندرية', 'سيدي بشر': 'الإسكندرية',
  'شبرا الخيمه': 'القليوبية', 'بنها': 'القليوبية', 'قليوب': 'القليوبية', 'العبور': 'القليوبية', 'الخانكه': 'القليوبية',
  'المنصوره': 'الدقهلية', 'ميت غمر': 'الدقهلية', 'طلخا': 'الدقهلية',
  'الزقازيق': 'الشرقية', 'العاشر من رمضان': 'الشرقية', 'بلبيس': 'الشرقية', 'منيا القمح': 'الشرقية',
  'العاشر': 'الشرقية', 'طنطا': 'الغربية', 'المحله': 'الغربية', 'كفر الزيات': 'الغربية',
  'شبين الكوم': 'المنوفية', 'مدينه السادات': 'المنوفية', 'منوف': 'المنوفية',
  'دمنهور': 'البحيرة', 'كفر الدوار': 'البحيرة',
  'التل الكبير': 'الإسماعيلية', 'القنطره': 'الإسماعيلية', 'فايد': 'الإسماعيلية',
  'بور فؤاد': 'بورسعيد', 'العين السخنه': 'السويس', 'الغردقه': 'البحر الأحمر', 'شرم الشيخ': 'جنوب سيناء', 'العريش': 'شمال سيناء',
  'ملوي': 'المنيا', 'نجع حمادي': 'قنا', 'مرسي مطروح': 'مطروح',
  // Cards printed in English.
  'nasr city': 'القاهرة', heliopolis: 'القاهرة', maadi: 'القاهرة', 'new cairo': 'القاهرة',
  october: 'الجيزة', 'sheikh zayed': 'الجيزة', mohandessin: 'الجيزة', dokki: 'الجيزة',
  tanta: 'الغربية', mahalla: 'الغربية', mansoura: 'الدقهلية', zagazig: 'الشرقية', '10th of ramadan': 'الشرقية',
  banha: 'القليوبية', 'shubra el kheima': 'القليوبية', damanhour: 'البحيرة', 'shebin el kom': 'المنوفية',
  hurghada: 'البحر الأحمر', 'sharm el sheikh': 'جنوب سيناء', arish: 'شمال سيناء', 'port fouad': 'بورسعيد',
};
// Longest first, so "شبرا الخيمه" wins over "شبرا".
/**
 * City names that are also everyday words or shop names ("معرض السلام",
 * "الشروق"): not taken as a place on their own.
 */
const NOT_PLACES = new Set(['السلام', 'الشروق', 'النزهه', 'الحسنه', 'الاربعين', 'مدينتي', 'السنطه', 'الزيتون']);
// Each governorate's cities (the same list the governorate pickers search),
// four letters or more, with the hand-written places above taking precedence.
for (const [governorate, cities] of Object.entries(GOVERNORATE_CITIES)) {
  for (const city of cities) {
    const key = foldArabic(city);
    if (key.replace(/\s/g, '').length >= 4 && !NOT_PLACES.has(key) && !(key in PLACES)) PLACES[key] = governorate;
  }
}
const PLACE_LIST = Object.entries(PLACES).sort(([a], [b]) => b.length - a.length);

const PHONE = /(?:\+|00)?(?:20)?[\s\-.()]*0?[\s\-.()]*1[\s\-.()]*[0125](?:[\s\-.()]*\d){8}/g;
/** A mobile written whole: with its leading 0, or with +20 / 0020 / 20 in front. */
const FULL_PHONE = /(?:(?:\+|00)?20[\s\-.()]*0?|0)[\s\-.()]*1[\s\-.()]*[0125](?:[\s\-.()]*\d){8}/g;
const ADDRESS_WORDS = /(شارع|ش\s*\.|^ش\s|\sش\s|طريق|ميدان|عماره|برج|بجوار|امام|خلف|تقاطع|ناصيه|المنطقه الصناعيه|محور|كورنيش|العنوان|street|\bst\b|road|\brd\b|square|address)/i;
const NAME_WORDS = /(قطع ?غيار|لقطع|قطع|اوتو|سيارات|موتورز|مركز|معرض|توكيل|محل|مؤسسه|موسسه|اولاد|للاستيراد|شركه|auto|parts|motors|cars|spare)/i;
const LABELS = /^(?:العنوان|عنوان|address|تليفون|تلفون|هاتف|موبايل|محمول|جوال|واتس(?:اب)?|whats ?app|tel|mob(?:ile)?|phone)\s*[:：\-]?\s*/i;
const NOISE = /(@|www\.|https?:|\.com|facebook|فيسبوك|instagram)/i;

const letterCount = (text: string) => (text.match(/[\p{L}]/gu) ?? []).length;
// Invisible left-to-right / right-to-left marks the reader leaves in mixed lines.
const tidy = (text: string) => text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').replace(/^[\s\-–—|:•.,]+|[\s\-–—|:•.,]+$/g, '').trim();

/** The first Egyptian mobile on the card, as 01XXXXXXXXX. */
export function findPhone(text: string): string | null {
  const lines = westernDigits(text).split(/\n/);
  // Read inside an Arabic line, "010 2345 6789" can come out as "6789 2345 010":
  // each line is tried as read, joined, and with its groups the other way round.
  const orders = (line: string) => {
    const groups = line.match(/\d+/g) ?? [];
    return [line, groups.join(' '), [...groups].reverse().join(' ')];
  };
  // A whole number first (01… or +20…), in any order of any line: a chunk
  // without its leading 0 found in a shuffled order is how wrong numbers come out.
  for (const line of lines) {
    for (const candidate of orders(line)) {
      for (const match of candidate.matchAll(FULL_PHONE)) {
        const e164 = toE164(match[0]);
        if (e164) return fromE164(e164);
      }
    }
  }
  // Then a number missing its leading 0, but only on a line of exactly ten
  // digits, read as printed: nothing there to put in the wrong order.
  for (const line of lines) {
    if ((line.match(/\d/g) ?? []).length !== 10) continue;
    for (const match of line.matchAll(PHONE)) {
      const e164 = toE164(match[0]);
      if (e164) return fromE164(e164);
    }
  }
  return null;
}

/**
 * The governorate the card is in: from a city or district it names (the most
 * specific clue; road names like "طريق مصر اسكندرية" name governorates the
 * shop is not in), else from a governorate it names.
 */
export function findGovernorate(text: string): string | null {
  const folded = ` ${foldArabic(text)} `;
  // The reader sometimes drops the space in two-word names ("مدينهنصر").
  const joined = folded.replace(/\s+/g, '');
  for (const [place, governorate] of PLACE_LIST) {
    if (folded.includes(place) || (place.includes(' ') && joined.includes(place.replace(/\s+/g, '')))) return governorate;
    // The reader often loses the "ا" of "ال": "لمنصوره" is "المنصوره".
    if (place.startsWith('ال') && !place.includes(' ') && new RegExp(`[\\s\\-|]ل${place.slice(2)}(?=[\\s,،.|\\-]|$)`).test(folded)) return governorate;
  }
  // Longer names first, so "شمال سيناء" wins over a bare "سيناء".
  for (const name of [...GOVERNORATES].sort((a, b) => b.length - a.length)) {
    const bare = foldArabic(name).replace(/^ال/, '');
    if (folded.includes(foldArabic(name)) || new RegExp(`[\\sو(]${bare}[\\s,،.)]`).test(folded)) return name;
    // Two-word governorates read without their space ("بنيسويف").
    if (name.includes(' ') && joined.includes(foldArabic(name).replace(/\s+/g, ''))) return name;
    const en = GOVERNORATES_EN[name]?.toLowerCase();
    if (en && folded.includes(en)) return name;
  }
  return null;
}

/** Pulls the shop's name, mobile, governorate and address out of the lines on its card. */
export function parseCard(read: CardLine[], numbers?: CardLine[]): CardDetails {
  const lines = joinRows(read);
  const clean = lines
    .map((line) => ({ ...line, text: mendLine(tidy(dropJunk(westernDigits(line.text)))) }))
    .filter((line) => line.confidence >= 35 && letterCount(line.text) + (line.text.match(/\d/g)?.length ?? 0) >= 3);
  const all = clean.map((line) => line.text).join('\n');

  // The number from the lines read for numbers when there are any, else from
  // the words. A number read without confidence is often garbled digits that
  // still look like a mobile: no number beats a wrong one.
  const sure = (list: CardLine[], confidence: number) =>
    list.filter((line) => line.confidence >= confidence).map((line) => westernDigits(line.text)).join('\n');
  const phone =
    findPhone(sure(numbers ?? read, PHONE_CONFIDENCE)) ??
    // Arabic-Indic digits (٠١٠…) only the Arabic reader sees, and only when it is very sure.
    (numbers ? findPhone(sure(read.filter((line) => /[٠-٩]{6}/.test(line.text.replace(/\s/g, ''))), ARABIC_DIGITS_CONFIDENCE)) : null);
  // The address and governorate may come from lines the reader was unsure of
  // (small print often reads right with low confidence): they are only taken
  // when they hold street words or a known place, which garbage rarely does.
  const loose = lines
    .map((line) => ({ ...line, text: mendLine(tidy(dropJunk(westernDigits(line.text)))) }))
    .filter((line) => letterCount(line.text) >= 6);
  const anywhere = () => findGovernorate(all) ?? findGovernorate(loose.map((line) => line.text).join('\n'));

  // The address: the line with street words, without its label or any numbers glued to it.
  // Else the line naming a city or governorate ("ميدات الجيش - الزقازيق", its
  // street word misread), if it is no phone line and not the biggest text (the name).
  const tallest = Math.max(0, ...clean.map((line) => line.height));
  const isStreet = (line: CardLine) => ADDRESS_WORDS.test(foldArabic(line.text)) && !NOISE.test(line.text);
  const namesPlace = (line: CardLine) =>
    line.height < tallest * 0.75 && !NOISE.test(line.text) && !/\d{6,}/.test(line.text.replace(/\D/g, '')) && findGovernorate(line.text) !== null && letterCount(line.text) >= 6;
  const addressLine = clean.find(isStreet) ?? clean.find(namesPlace) ?? loose.find(isStreet) ?? loose.find(namesPlace);
  const address = addressLine ? tidy(addressLine.text.replace(LABELS, '').replace(PHONE, '')) || null : null;
  // The governorate from the address first: a place word in the shop's name
  // ("معرض الشروق") is not where the shop is.
  const city = (address && findGovernorate(address)) || anywhere();

  // The name: a line with no digits that is not the address, preferring
  // shop words ("قطع غيار", "auto"), then the biggest text on the card.
  const candidates = clean.filter(
    (line) =>
      line !== addressLine &&
      !/\d{3,}/.test(line.text) &&
      !NOISE.test(line.text) &&
      !LABELS.test(line.text) &&
      letterCount(line.text) >= 3 &&
      line.text.length <= 60 &&
      !TAGLINE.test(foldArabic(line.text)),
  );
  // The biggest text on the card, read or not (but not a lone mark like a logo's letter).
  const biggest = Math.max(0, ...lines.filter((line) => letterCount(line.text) >= 3).map((line) => line.height));
  const best = pickNameLine(candidates, biggest);
  const shopName = best ? fixWords(tidy(best.text)).slice(0, 60) || null : null;

  return { shopName, phone, city, address: address && address.length >= 5 ? fixWords(address).slice(0, 200) : null };
}

/**
 * A tagline, not a name: a list split by dashes ("زيوت - فلاتر - فرامل") or
 * the usual openings ("جميع قطع الغيار", "جملة وقطاعي"). When the name itself
 * cannot be read, an empty field is better than the tagline in its place.
 */
const TAGLINE = /(\S\s*[-–]\s*\S.*[-–]|^جميع|^جمله|^نبيع|^متخصص|^افضل|^بافضل|^استيراد|^توكيلات|^صيانه)/;

/** How sure the reader must be of a line to take a phone number from it. */
export const PHONE_CONFIDENCE = 70;
/** How sure the Arabic reader must be of a number in Arabic-Indic digits. */
const ARABIC_DIGITS_CONFIDENCE = 85;

/**
 * Latin scraps and stray symbols the reader puts in Arabic lines ("ail",
 * "©", "J" from a logo's edge). A mostly-Latin line ("AUTO PARTS") is left as is.
 */
export function dropJunk(text: string): string {
  const arabic = (text.match(/[\u0621-\u064A]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  // The invisible direction marks around Latin bits go first, or they hide them.
  // ...and the diacritics the reader adds ("شََّ") are not on cards.
  let out = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u064B-\u0652]/g, '').replace(/[©®™|•§¤¦\[\]{}<>«»؛"]+/g, ' ');
  if (arabic > latin) {
    out = out
      // Latin glued to Arabic is cut off first ("ailالأمتيراد"), then short Latin runs go.
      .replace(/([A-Za-z])(?=[\u0621-\u064A])/g, '$1 ')
      .replace(/([\u0621-\u064A])(?=[A-Za-z])/g, '$1 ')
      .replace(/(^|\s)[A-Za-z()]{1,6}(?=\s|$)/g, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * The shop's name is almost always the biggest text on its card: among the
 * lines nearly as tall as the tallest, the one with shop words ("لقطع غيار",
 * "auto"), else the tallest. A tagline in small print never wins on its words.
 */
export function pickNameLine<T extends CardLine>(candidates: T[], biggest = 0): T | null {
  if (!candidates.length) return null;
  const tallest = Math.max(...candidates.map((line) => line.height));
  // The name was the biggest text and could not be read: leave it empty.
  if (biggest && tallest < biggest * 0.6) return null;
  const big = candidates.filter((line) => line.height >= tallest * 0.75);
  const named = big.filter((line) => NAME_WORDS.test(foldArabic(line.text)));
  return (named.length ? named : big).reduce((top, line) => (line.height > top.height ? line : top));
}

/**
 * Words that fill spare-parts shops' cards, used to put back what the reader
 * gets wrong: a letter off ("غبار" for "غيار") or a lost space ("غيارالسيارات").
 */
const CARD_WORDS = [
  'شارع', 'ميدان', 'طريق', 'برج', 'عمارة', 'بجوار', 'أمام',
  'قطع', 'لقطع', 'غيار', 'الغيار', 'السيارات', 'سيارات', 'للسيارات', 'مركز', 'معرض', 'توكيل', 'محل', 'مؤسسة', 'شركة', 'أولاد', 'بيت', 'دار',
  'أوتو', 'موتورز', 'موتور', 'سنتر', 'بارتس', 'كماليات', 'لكماليات', 'اكسسوارات', 'لزيوت', 'للعفشة', 'والفرامل', 'لكهرباء', 'للكاوتش', 'والبطاريات', 'للاستيراد', 'والتصدير', 'استيراد', 'الكورية', 'اليابانية', 'الأوروبية', 'الألمانية',
  'الصينية', 'الملاكي', 'النقل', 'الأصلية', 'والتجارية', 'التجارية', 'كاوتش', 'بطاريات', 'زيوت', 'كهرباء', 'عفشة', 'فرامل',
  'تويوتا', 'هيونداي', 'كيا', 'نيسان', 'شيفروليه', 'ميتسوبيشي', 'سوزوكي', 'بيجو', 'البيجو', 'رينو', 'فيات', 'سكودا', 'أوبل', 'مرسيدس',
  'بي ام', 'هوندا', 'مازدا', 'شيري', 'جيلي', 'بي واي دي', 'ام جي', 'لادا', 'فولكس', 'دايو', 'لانسر', 'فيرنا', 'كورولا', 'النترا',
];
const WORDS_BY_FORM = new Map(CARD_WORDS.map((word) => [foldArabic(word), word]));
/**
 * The words a one-letter slip is corrected towards: ones with no name a
 * letter away. "النقل" is not one ("النيل" is a shop name), nor are makes.
 */
const CORRECTABLE = new Map(
  ['مركز', 'معرض', 'مؤسسة', 'غيار', 'الغيار', 'لقطع', 'السيارات', 'للسيارات', 'موتورز', 'للاستيراد', 'والتصدير', 'الكورية', 'اليابانية', 'الأوروبية', 'التجارية', 'والتجارية', 'الأصلية', 'الملاكي', 'لكهرباء', 'البطاريات', 'الكاوتش', 'كماليات', 'لكماليات', 'اكسسوارات'].map((word) => [foldArabic(word), word]),
);
// Longest first, so "السيارات" is found before "سيارات" inside a glued run.
const GLUE_WORDS = [...WORDS_BY_FORM.entries()].filter(([form]) => form.length >= 4 && !form.includes(' ')).sort((a, b) => b[0].length - a[0].length);

/** Same length and one letter different: how the reader misreads a letter ("غبار" for "غيار"). */
const oneLetterOff = (a: string, b: string) => a.length === b.length && [...a].filter((ch, i) => ch !== b[i]).length === 1;

/**
 * A card word of four letters or more read with one letter wrong: the card
 * word. Only swaps, never adds or drops a letter, so "الكوري" stays itself.
 */
const PREFIX = /^(وال|بال|لل|ال|و|ب|ل)/;
const stem = (w: string) => w.replace(PREFIX, '');

function correctWord(word: string): string {
  const form = foldArabic(word);
  if (WORDS_BY_FORM.has(form)) return /[\u0600-\u06FF]/.test(word) ? WORDS_BY_FORM.get(form)! : word;
  if (/^ال[\u0600-\u06FF]{2,}ه$/.test(word) && word.length >= 5) return `${word.slice(0, -1)}ة`;
  if (form.length < 4 || !/[\u0600-\u06FF]/.test(word)) return word;
  for (const [known, original] of CORRECTABLE) {
    // "للكاوتش" and "الكاوتش" are both right: the prefix is the writer's, not a slip.
    if (oneLetterOff(form, known) && stem(form) !== stem(known)) return original;
  }
  // A long word with its stem one letter off a card word's ("الأمتيراد"):
  // the writer's prefix, the card word's stem.
  const own = stem(form);
  if (own.length >= 5) {
    for (const [known, original] of CORRECTABLE) {
      const theirs = stem(known);
      if (theirs.length >= 5 && oneLetterOff(own, theirs)) return word.slice(0, form.length - own.length) + stem(original);
    }
  }
  return word;
}

/** A run of glued words split back apart at the card words in it. */
function unglue(token: string): string {
  if (token.length < 6 || !/[\u0600-\u06FF]/.test(token)) return token;
  const form = foldArabic(token);
  if (WORDS_BY_FORM.has(form)) return token;
  for (const [known] of GLUE_WORDS) {
    let at = form.indexOf(known);
    if (at < 0) continue;
    const end = at + known.length;
    // "...والبطاريات": the word keeps its "ال", "لل" and "و" in front.
    if (form.slice(at - 2, at) === 'ال' && at - 2 >= 3) at -= 2;
    else if (form.slice(at - 2, at) === 'لل' && at - 2 >= 3) at -= 2;
    if (form[at - 1] === 'و' && at - 1 >= 3) at -= 1;
    const before = token.slice(0, at);
    const after = token.slice(end);
    // Each piece left over must be a word of its own, three letters or more ("محلات" stays whole).
    if ((before && before.length < 3) || (after && after.length < 3) || (!before && !after)) continue;
    return [before && unglue(before), token.slice(at, end), after && unglue(after)].filter(Boolean).join(' ');
  }
  // A card word with one letter misread, glued to the end ("المصريمونورز").
  for (const [known, original] of CORRECTABLE) {
    if (known.length < 5 || form.length - known.length < 3) continue;
    const tail = form.slice(-known.length);
    if (oneLetterOff(tail, known)) return `${unglue(token.slice(0, token.length - known.length))} ${original}`;
  }
  // "ال" starts a new word after two letters or more ("قطعالغيار"), and "و"
  // after a word ending in "ة" ("الأصليةوالتجارية").
  const split = token
    .replace(/(?<=[\u0600-\u06FF]{2,})(?=وال[\u0600-\u06FF]{3,})/u, ' ')
    .replace(/(?<=[\u0600-\u06FF]{2,}[^و ])(?=ال[\u0600-\u06FF]{3,})/u, ' ')
    .replace(/(?<=ة)(?=و[\u0600-\u06FF]{3,})/u, ' ');
  return split === token ? token : split.split(' ').map(unglue).join(' ');
}

/**
 * A lone Arabic letter is a word cut in two by a stray space ("الإخلا ص"),
 * except "و" (and) and the street abbreviation "ش".
 */
const rejoin = (text: string) => text.replace(/([\u0600-\u06FF]{2,}) ([\u0621-\u064A])(?=\s|$)/gu, (whole, word: string, letter: string) => ('وش'.includes(letter) ? whole : word + letter));

/** A line with its split words put back ("شا رع" → "شارع"), nothing else changed. */
const mendLine = (text: string) =>
  mend(
    rejoin(text)
      // A digit stuck to a word ("1شا") is a separate thing.
      .replace(/(\d)(?=[ء-ي])|([ء-ي])(?=\d)/g, '$1$2 ')
      .split(' '),
  ).join(' ');

/** Two pieces that are no words of their own but make a card word together ("للكا وتش"). */
function mend(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i]!;
    const b = tokens[i + 1];
    if (b && !WORDS_BY_FORM.has(foldArabic(a)) && !WORDS_BY_FORM.has(foldArabic(b)) && /[\u0600-\u06FF]$/.test(a) && /^[\u0600-\u06FF]/.test(b)) {
      const joined = foldArabic(a + b);
      if ([...WORDS_BY_FORM.keys()].some((known) => (known.length >= 4 && joined === known) || (known.length >= 5 && stem(joined) === stem(known)))) {
        out.push(a + b);
        i++;
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

/** The card's words with the reader's usual slips put right. */
export function fixWords(text: string): string {
  return mend(rejoin(text).split(/\s+/))
    .flatMap((token) => unglue(correctWord(token)).split(' '))
    .map(correctWord)
    .join(' ');
}
