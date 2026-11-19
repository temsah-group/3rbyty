import { useEffect } from 'react';

import { useI18n } from './i18n';

const SITE = { ar: 'عربيتي', en: '3arabity' };
const DEFAULT_TITLE = { ar: 'عربيتي 3rbyty — قطع غيار العربيات في مصر', en: '3arabity (3rbyty) — car parts in Egypt' };
const DEFAULT_DESCRIPTION = {
  ar: 'عربيتي: اشتري وبيع قطع غيار العربيات في مصر، جديد ومستعمل واستيراد. دوّر بالماركة والموديل والسنة واتواصل مع البيّاع مباشرة.',
  en: '3arabity: buy and sell car parts in Egypt, new, used and imported. Search by make, model and year and contact the seller directly.',
};
/** The site's address; build-time from .env, else wherever it is served. */
export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin).replace(/\/+$/, '');
const DEFAULT_IMAGE = `${SITE_URL}/og.jpg`;

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.content = content;
}

function setCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = href;
}

function apply(title: string, description: string, image: string, noindex: boolean) {
  document.title = title;
  // One address per page for search engines: no query string, no trailing slash.
  const url = `${SITE_URL}${window.location.pathname.replace(/(.)\/+$/, '$1')}`;
  setMeta('name', 'description', description);
  setMeta('name', 'robots', noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large');
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', description);
  setMeta('property', 'og:url', url);
  setMeta('property', 'og:image', image);
  setCanonical(url);
}

/** An absolute address for a photo path or URL, for share previews and structured data. */
export function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * The tab title, description and share details for one page; the site's own
 * while [title] is null (still loading) and again once the page closes.
 * Search engines read these after running the page. [noindex] keeps a page
 * (an empty search, a private page) out of search results.
 */
export function usePageMeta(
  title: string | null | undefined,
  description?: string | null,
  options: { image?: string | null; noindex?: boolean } = {},
) {
  const { lang } = useI18n();
  const image = absoluteUrl(options.image) ?? DEFAULT_IMAGE;
  const noindex = options.noindex ?? false;
  useEffect(() => {
    const fullTitle = title ? `${title} | ${SITE[lang]}` : DEFAULT_TITLE[lang];
    const text = description?.replace(/\s+/g, ' ').trim();
    apply(fullTitle, text ? (text.length > 160 ? `${text.slice(0, 157)}…` : text) : DEFAULT_DESCRIPTION[lang], image, noindex);
    return () => apply(DEFAULT_TITLE[lang], DEFAULT_DESCRIPTION[lang], DEFAULT_IMAGE, false);
  }, [title, description, lang, image, noindex]);
}

/**
 * Structured data (schema.org JSON-LD) for the page, so search results can
 * show a part's price and stock or a shop's rating and address. Null removes it.
 */
export function useJsonLd(data: object | null | undefined) {
  const json = data ? JSON.stringify(data) : null;
  useEffect(() => {
    if (!json) return;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.page = 'true';
    script.text = json;
    document.head.appendChild(script);
    return () => script.remove();
  }, [json]);
}
