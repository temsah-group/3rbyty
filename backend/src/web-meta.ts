import { Types } from 'mongoose';

import { findBrand, findModel, type PartCategory, type PartCondition } from './modules/catalog/catalog.js';
import type { PartModel } from './modules/parts/part.model.js';
import type { ShopModel } from './modules/shops/shop.model.js';

/**
 * What one page of the website is about, written into the HTML before it is
 * sent: link previews (WhatsApp, Facebook) don't run the site's JavaScript,
 * and search engines see a page's title, photo and price on their first read.
 */
export type PageMeta = {
  title: string;
  description: string;
  /** Absolute, or null for the site's own share picture. */
  image: string | null;
  /** The page's own address, without a query string. */
  path: string;
  jsonLd?: object;
  /** A part or shop that isn't there (any more): a 404, kept out of search results. */
  notFound?: boolean;
};

const SITE = 'عربيتي';
/** 3arabity's pages elsewhere (the same as the website's footer). */
const SOCIAL = ['https://www.facebook.com/profile.php?id=61596902270564', 'https://www.instagram.com/3rbyty_/', 'https://www.tiktok.com/@3rbyty'];
const NAMES = ['3rbyty', 'عربيتي 3rbyty', '3arabity'];
const CATEGORY: Record<PartCategory, string> = {
  ENGINE: 'المحرك',
  BRAKES: 'الفرامل',
  SUSPENSION: 'العفشة',
  ELECTRICAL: 'الكهرباء',
  BODY: 'الصاج والبودي',
  LIGHTS: 'الفوانيس',
  FILTERS: 'الفلاتر والزيوت',
  TYRES: 'الكاوتش والجنوط',
};
const CONDITION: Record<PartCondition, string> = { NEW: 'جديد', USED: 'مستعمل', IMPORTED: 'استيراد' };

/** The site's fixed pages. */
const STATIC: Record<string, { title: string; description: string }> = {
  '/search': {
    title: `كل قطع الغيار | ${SITE}`,
    description: 'دوّر على قطع غيار عربيتك بالماركة والموديل والسنة: جديد ومستعمل واستيراد من بياعين ومحلات في كل مصر.',
  },
  '/shops': {
    title: `محلات قطع الغيار | ${SITE}`,
    description: 'محلات قطع غيار العربيات في مصر على عربيتي: دوّر بالمحافظة والماركة واتواصل مع المحل مباشرة.',
  },
  '/help': { title: `المساعدة | ${SITE}`, description: 'إزاي تشتري وتبيع قطع غيار على عربيتي، وإزاي تحمي نفسك من النصب.' },
  '/app': { title: `نزّل تطبيق عربيتي | ${SITE}`, description: 'حط عربيتي على شاشة موبايلك: يفتح أسرع زي التطبيق، من غير متجر ومن غير مساحة.' },
  '/connect': { title: `عربيتي: سوق قطع الغيار في مصر`, description: 'دوّر على قطعة عربيتك، اطلب اللي مش لاقيه، أو اعرض قطعك للبيع. واتساب عربيتي وصفحاتنا على السوشيال ميديا.' },
  '/legal/terms': { title: `شروط الاستخدام | ${SITE}`, description: 'شروط استخدام عربيتي، سوق قطع غيار العربيات في مصر.' },
  '/legal/privacy': { title: `سياسة الخصوصية | ${SITE}`, description: 'إزاي عربيتي بيحافظ على بياناتك.' },
};

const short = (text: string, max = 160) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/** "تويوتا كورولا 2014–2018، هيونداي": the cars a part fits, for its description. */
function carsOf(fitments: { brandId: string; brandName?: string | null; modelId?: string | null; modelName?: string | null; fromYear?: number | null; toYear?: number | null }[]) {
  return fitments
    .slice(0, 3)
    .map((f) => {
      const brand = f.brandName ?? findBrand(f.brandId)?.nameAr ?? '';
      const model = f.modelName ?? (f.modelId ? findModel(f.brandId, f.modelId)?.nameAr : '') ?? '';
      const years = f.fromYear ? (f.toYear && f.toYear !== f.fromYear ? ` ${f.fromYear}–${f.toYear}` : ` ${f.fromYear}`) : '';
      return `${brand} ${model}`.trim() + (model ? years : '');
    })
    .filter(Boolean)
    .join('، ');
}

/** Reads what a page shows, for [pageMeta]'s HTML. Null: the site's own (the home page, private pages). */
export function pageMetaResolver(models: { Part: PartModel; Shop: ShopModel }, siteUrl: string) {
  const absolute = (src: string | null | undefined) => (!src ? null : /^https?:\/\//.test(src) ? src : `${siteUrl}${src.startsWith('/') ? '' : '/'}${src}`);

  return async function pageMeta(path: string): Promise<PageMeta | null> {
    const clean = path.replace(/(.)\/+$/, '$1');
    if (clean === '/') {
      return {
        title: 'عربيتي 3rbyty — قطع غيار العربيات في مصر',
        description: 'عربيتي: اشتري وبيع قطع غيار العربيات في مصر، جديد ومستعمل واستيراد. دوّر بالماركة والموديل والسنة واتواصل مع البيّاع مباشرة.',
        image: null,
        path: '/',
        jsonLd: {
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebSite', '@id': `${siteUrl}/#website`, url: `${siteUrl}/`, name: SITE, alternateName: NAMES, inLanguage: 'ar-EG' },
            { '@type': 'Organization', '@id': `${siteUrl}/#organization`, name: SITE, alternateName: NAMES, url: `${siteUrl}/`, logo: `${siteUrl}/icon-512.png`, sameAs: SOCIAL },
          ],
        },
      };
    }
    if (STATIC[clean]) return { ...STATIC[clean]!, image: null, path: clean };

    const part = clean.match(/^\/parts\/([^/]+)$/);
    if (part) {
      const id = part[1]!;
      const found = Types.ObjectId.isValid(id) ? await models.Part.findById(id).lean().exec() : null;
      if (!found || found.hiddenAt) {
        return { title: `القطعة دي مش موجودة | ${SITE}`, description: 'ممكن البياع شالها. دوّر على قطع تانية على عربيتي.', image: null, path: clean, notFound: true };
      }
      const shop = found.shopId ? await models.Shop.findById(found.shopId).select('name').lean().exec() : null;
      const cars = found.fitsAllCars ? 'يركب على كل العربيات' : carsOf(found.fitments);
      const condition = CONDITION[found.condition as PartCondition];
      const facts = [`${condition}${found.isOriginal ? ' أصلي' : ''}`, found.price != null && `${found.price.toLocaleString('en')} جنيه`, found.city, cars && `لـ ${cars}`].filter(Boolean);
      const itemCondition = found.condition === 'USED' ? 'https://schema.org/UsedCondition' : 'https://schema.org/NewCondition';
      const url = `${siteUrl}${clean}`;
      return {
        title: `${found.name}${cars && !found.fitsAllCars ? ` ${carsOf(found.fitments.slice(0, 1))}` : ''} | ${SITE}`,
        description: short([facts.join(' · '), found.description].filter(Boolean).join('. ')),
        image: absolute(found.images[0]),
        path: clean,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: found.name,
          description: found.description ?? undefined,
          image: found.images.map(absolute).filter(Boolean),
          sku: found.partNumber ?? undefined,
          mpn: found.partNumber ?? undefined,
          category: CATEGORY[found.category as PartCategory],
          itemCondition,
          ...(found.rating && found.rating.count > 0
            ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: found.rating.avg.toFixed(1), reviewCount: found.rating.count } }
            : {}),
          offers: {
            '@type': 'Offer',
            url,
            ...(found.price == null ? {} : { price: found.price, priceCurrency: 'EGP' }),
            availability: found.isSold ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
            itemCondition,
            areaServed: { '@type': 'Country', name: 'Egypt' },
            ...(shop ? { seller: { '@type': 'AutoPartsStore', name: shop.name } } : {}),
          },
        },
      };
    }

    const shopPath = clean.match(/^\/shops\/([^/]+)$/);
    if (shopPath) {
      const id = shopPath[1]!;
      const shop = Types.ObjectId.isValid(id) ? await models.Shop.findById(id).lean().exec() : null;
      if (!shop || shop.status !== 'APPROVED' || shop.hiddenAt) {
        return { title: `المحل ده مش موجود | ${SITE}`, description: 'دوّر على محلات قطع غيار تانية على عربيتي.', image: null, path: clean, notFound: true };
      }
      const url = `${siteUrl}${clean}`;
      return {
        title: `${shop.name} — قطع غيار في ${shop.city} | ${SITE}`,
        description: short(shop.description || `محل قطع غيار ${shop.name} في ${shop.city}${shop.address ? `، ${shop.address}` : ''}. شوف قطعه وأسعاره واتواصل معاه مباشرة على عربيتي.`),
        image: absolute(shop.coverUrl ?? shop.logoUrl),
        path: clean,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'AutoPartsStore',
          name: shop.name,
          url,
          description: shop.description ?? undefined,
          image: absolute(shop.coverUrl ?? shop.logoUrl) ?? undefined,
          logo: absolute(shop.logoUrl) ?? undefined,
          telephone: shop.phone,
          address: { '@type': 'PostalAddress', streetAddress: shop.address, addressRegion: shop.city, addressCountry: 'EG' },
          ...(shop.location?.lat != null && shop.location?.lng != null
            ? { geo: { '@type': 'GeoCoordinates', latitude: shop.location.lat, longitude: shop.location.lng } }
            : {}),
          ...(shop.rating && shop.rating.count > 0
            ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: shop.rating.avg.toFixed(1), reviewCount: shop.rating.count } }
            : {}),
        },
      };
    }
    return null;
  };
}

export type PageMetaResolver = ReturnType<typeof pageMetaResolver>;

const attr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** [html] (the site's index.html) with [meta] written into its head. */
export function withPageMeta(html: string, meta: PageMeta, siteUrl: string): string {
  const url = `${siteUrl}${meta.path}`;
  const image = meta.image ?? `${siteUrl}/og.jpg`;
  const setContent = (source: string, pattern: RegExp, value: string) => source.replace(pattern, (_m, start: string) => `${start}${attr(value)}"`);
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${attr(meta.title)}</title>`);
  out = setContent(out, /(<meta name="description" content=")[^"]*"/, meta.description);
  out = setContent(out, /(<meta property="og:title" content=")[^"]*"/, meta.title);
  out = setContent(out, /(<meta property="og:description" content=")[^"]*"/, meta.description);
  out = setContent(out, /(<meta property="og:url" content=")[^"]*"/, url);
  out = setContent(out, /(<meta property="og:image" content=")[^"]*"/, image);
  out = setContent(out, /(<link rel="canonical" href=")[^"]*"/, url);
  if (meta.image) {
    // The part's own photo: not the 1200x630 share picture the defaults describe.
    out = out.replace(/\s*<meta property="og:image:(?:width|height|alt)"[^>]*>/g, '');
  }
  const extra = [
    meta.notFound ? '<meta name="robots" content="noindex, follow" />' : '',
    meta.jsonLd ? `<script type="application/ld+json" data-ssr>${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ].join('');
  return extra ? out.replace('</head>', `${extra}</head>`) : out;
}
