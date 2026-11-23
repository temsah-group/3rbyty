import { normalizeSearchText } from './catalog.js';
import { SEARCH_TERMS } from './search-terms.js';

/** Each normalised word to every word of its groups (a word may be in more than one). */
const SAME: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of SEARCH_TERMS) {
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
