import { normalizeSearchText } from './catalog.js';

/**
 * The names people use for the same thing: Egyptian, standard Arabic,
 * English and Franco, and the usual misspellings. A search for any of them
 * finds parts listed under the others ("سلف" finds a "مارش"). Words only,
 * each group meaning exactly the same; checked after normalising (أ→ا, ة→ه).
 */
const GROUPS: string[][] = [
  // Electrical
  ['مارش', 'سلف', 'ستارتر', 'استارتر', 'starter', 'مارشات'],
  ['دينامو', 'دينمو', 'الترنيتر', 'التيرناتور', 'alternator', 'دينامات'],
  ['بطاريه', 'بطاريات', 'باتري', 'battery'],
  ['حساس', 'حساسات', 'سنسور', 'سنسر', 'sensor', 'sensors'],
  ['كويل', 'بوبينه', 'بوبينة', 'coil', 'كويلات'],
  ['بوجيه', 'بوجيهات', 'بوجي', 'شمعه', 'spark', 'plug', 'plugs'],
  ['كمبيوتر', 'ecu', 'ecm'],
  ['لمبه', 'لمبات', 'لمبة', 'bulb', 'bulbs'],
  ['كلاكس', 'بوري', 'زماره', 'horn'],
  ['ضفيره', 'ضفيرة', 'ضفاير', 'wiring', 'harness'],
  // Engine and cooling
  ['موتور', 'مكنه', 'ماكينه', 'محرك', 'engine', 'motor'],
  ['جوان', 'جوانات', 'gasket', 'gaskets'],
  ['بستم', 'بساتم', 'بيستون', 'piston', 'pistons'],
  ['تيربو', 'تربو', 'turbo'],
  ['كاتينه', 'كاتينة', 'جنزير', 'سلسله', 'chain'],
  ['سير', 'سيور', 'belt', 'belts'],
  ['ردياتير', 'رداتير', 'راديتر', 'رادياتير', 'ريداتير', 'radiator'],
  ['مروحه', 'مراوح', 'fan', 'fans'],
  ['طلمبه', 'طلمبات', 'مضخه', 'طرمبه', 'pump'],
  ['ترموستات', 'ثرموستات', 'ثيرموستات', 'thermostat'],
  ['كمبروسر', 'كومبروسر', 'كباس', 'compressor'],
  ['تكييف', 'مكيف', 'تكيف', 'ac'],
  ['شكمان', 'عادم', 'exhaust', 'muffler'],
  ['بخاخ', 'بخاخات', 'انجكتور', 'رشاش', 'injector', 'injectors'],
  ['دبرياج', 'كلتش', 'كلاتش', 'clutch'],
  ['فتيس', 'جيربوكس', 'جير', 'gearbox', 'transmission'],
  ['مياه', 'ميه', 'مايه', 'water'],
  ['بنزين', 'وقود', 'fuel'],
  ['زيت', 'زيوت', 'oil'],
  ['فلتر', 'فلاتر', 'filter', 'filters'],
  ['هوا', 'هواء', 'air'],
  // Brakes
  ['تيل', 'فحمات', 'فحمه', 'pads', 'pad'],
  ['طنبوره', 'طنابير', 'ديسك', 'اسطوانه', 'disc', 'disk', 'rotor'],
  ['فرامل', 'فرامله', 'brake', 'brakes'],
  ['كاليبر', 'كليبر', 'caliper'],
  // Suspension and steering
  ['مساعد', 'مساعدين', 'مساعدات', 'امتصاص', 'shock', 'shocks', 'absorber'],
  ['مقص', 'مقصات', 'arm', 'arms'],
  ['جلبه', 'جلب', 'جلبة', 'بوش', 'bush', 'bushing'],
  ['بلي', 'بليه', 'رولمان', 'bearing', 'bearings'],
  ['دريكسيون', 'دركسيون', 'دريكسون', 'steering'],
  ['مقود', 'طاره', 'دركسيون'],
  // Body and glass
  ['اكصدام', 'اكسدام', 'صدام', 'اكصدامات', 'bumper'],
  ['كبوت', 'كابوت', 'كبود', 'hood', 'bonnet'],
  ['رفرف', 'رفارف', 'fender'],
  ['باب', 'ابواب', 'door', 'doors'],
  ['شبكه', 'جريل', 'grill', 'grille'],
  ['مرايه', 'مراية', 'مرايات', 'مرآه', 'mirror', 'mirrors'],
  ['زجاج', 'ازاز', 'قزاز', 'glass', 'windshield'],
  ['مساحات', 'مساحه', 'مساحة', 'wiper', 'wipers'],
  ['شنطه', 'شنطة', 'trunk', 'boot'],
  // Lights
  ['فانوس', 'فوانيس', 'headlight', 'headlights', 'lamp'],
  ['اسطب', 'استوب', 'stop', 'taillight'],
  ['كشاف', 'كشافات', 'ضباب', 'fog'],
  // Tyres and wheels
  // Not "كفر": it is also كفر الشيخ, كفر الدوار…
  ['كاوتش', 'كاوتشات', 'اطار', 'اطارات', 'tire', 'tires', 'tyre', 'tyres'],
  ['جنط', 'جنوط', 'rim', 'rims', 'wheel', 'wheels'],
  // Sides and places, as people say them
  ['امامي', 'قدامي', 'front'],
  ['خلفي', 'ورا', 'وراني', 'rear', 'back'],
  ['يمين', 'right'],
  ['شمال', 'يسار', 'left'],
  // Condition and kind
  ['جديد', 'زيرو', 'new'],
  ['مستعمل', 'used'],
  ['اصلي', 'اوريجينال', 'وكاله', 'original', 'genuine', 'oem'],
  ['تجاري', 'كوبي', 'aftermarket'],
  ['استيراد', 'مستورد', 'imported'],
  // Makes, as they are often spelled
  ['شيفروليه', 'شفروليه', 'شيفروليت', 'شفروليت', 'شيفرولية', 'chevrolet', 'chevy'],
  ['هيونداي', 'هيونداى', 'هيوندا', 'هونداي', 'hyundai'],
  ['مرسيدس', 'مارسيدس', 'بنز', 'mercedes', 'benz'],
  ['فولكس', 'فلوكس', 'فولكسفاجن', 'vw', 'volkswagen'],
  ['تويوتا', 'تيوتا', 'toyota'],
  ['متسوبيشي', 'ميتسوبيشي', 'mitsubishi'],
  ['بيجو', 'بيچو', 'peugeot'],
  // Oil brands, written in English on the bottle and said in Arabic.
  ['شل', 'شيل', 'shell'],
  ['موبيل', 'موبل', 'mobil'],
  ['توتال', 'total'],
  ['كاسترول', 'كاسترل', 'castrol'],
  ['فالفولين', 'valvoline'],
];

/** Each normalised word to every word of its groups (a word may be in more than one). */
const SAME: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of GROUPS) {
    const words = group.map((word) => normalizeSearchText(word));
    for (const word of words) {
      const known = map.get(word) ?? new Set<string>();
      for (const other of words) known.add(other);
      map.set(word, known);
    }
  }
  return map;
})();

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A word's start in a part's text, maybe after ال/و/ب/ل ("الفانوس", "والفانوس"). */
const START = '(^|\\s)(ال|و|ب|ل|وال|بال)?';
const END = '(\\s|$)';

/**
 * How one typed or alternative word may appear in a part's text: from the
 * start of a word ("فانو" finds "فانوس"), and a short word (3 letters or
 * fewer) only as a whole word ("سير" is a belt, not the start of "سيراتو").
 * A word with digits (a part number, "5w40", "3500") anywhere, as typed.
 */
function wordPattern(word: string): string {
  const escaped = escape(word);
  if (/\d/.test(word)) return escaped;
  // Short and a word in its own right ("سير", "تيل", "شل"): whole. Short and
  // half-typed ("مار" on the way to "مارش"): the start of a word, so
  // suggestions keep up while typing.
  return word.length <= 3 && SAME.has(word) ? `${START}${escaped}${END}` : `${START}${escaped}`;
}

/**
 * A regular expression for [word] (already normalised) against a part's
 * search text: the word, the word without "ال" ("الفانوس" finds "فانوس"),
 * and the other names of the same thing ("سلف" finds "مارش").
 */
export function searchPattern(word: string): string {
  const forms = new Set([word]);
  if (word.startsWith('ال') && word.length > 4) forms.add(word.slice(2));
  for (const form of [...forms]) for (const other of SAME.get(form) ?? []) forms.add(other);
  return [...forms].map(wordPattern).join('|');
}

/**
 * The same, against a part's name as written (not normalised): the letters
 * people type either way (ا/أ/إ/آ, ه/ة, ي/ى) accept both. For ranking:
 * a part whose name has the word comes before one that matched by car.
 */
export function namePattern(word: string): string {
  return nameLetters(searchPattern(word));
}

/** [pattern] accepting either way of writing ا/أ/إ/آ, ه/ة and ي/ى, for matching names as written. */
export function nameLetters(pattern: string): string {
  return pattern.replace(/ا/g, '[اأإآ]').replace(/ه/g, '[هة]').replace(/ي/g, '[يى]');
}

/** [words] one after another in a name ("شورت بلوك"), each as typed. */
export function phrasePattern(words: string[]): string {
  return nameLetters(words.map(escape).join('\\s+'));
}

/** [word] as the very first word of a name ("مارش …"), or one of its other names. */
export function leadingPattern(word: string): string {
  const forms = new Set([word, ...(SAME.get(word) ?? [])]);
  return nameLetters(`^(ال)?(${[...forms].map(escape).join('|')})`);
}
