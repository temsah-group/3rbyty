import { z } from 'zod';

import { phone } from '../auth/auth.schemas.js';
import { carKey, OLDEST_YEAR, lastYear, listYears, resolveCar } from '../catalog/car-ref.js';
import { isGovernorate, PART_CATEGORIES, PART_CONDITIONS } from '../catalog/catalog.js';

export const MAX_PART_PHOTOS = 8;
const MAX_FITMENTS = 20;

/**
 * A make alone (every model of it), or a make and model with years. The make
 * or model may be typed when not in the catalog (`brandId: "other"` with a
 * `brandName`, or a `modelName`). Years left out mean all of them: for a
 * catalog model from 1998 (or its first year) on; years may go back to 1950.
 */
const fitment = z
  .strictObject({
    brandId: z.string('validation.fitment'),
    brandName: z.string('validation.fitment').max(60, 'validation.fitment').nullish(),
    modelId: z.string('validation.fitment').nullish(),
    modelName: z.string('validation.fitment').max(60, 'validation.fitment').nullish(),
    fromYear: z.number('validation.fitment').int('validation.fitment').nullish(),
    toYear: z.number('validation.fitment').int('validation.fitment').nullish(),
  })
  .transform((value, ctx) => {
    const car = resolveCar(value);
    if (!car) {
      ctx.addIssue({ code: 'custom', message: 'validation.fitment' });
      return z.NEVER;
    }
    const { model, ...ref } = car;
    // A make alone has no years.
    if (!ref.modelId && !ref.modelKey) return { ...ref, fromYear: null, toYear: null };
    const last = lastYear(model);
    let fromYear = value.fromYear ?? null;
    let toYear = value.toYear ?? null;
    if (model) {
      fromYear ??= listYears(model)[0];
      toYear ??= last;
    } else if ((fromYear === null) !== (toYear === null)) {
      // A typed model: both years, or neither (all of them).
      fromYear ??= toYear;
      toYear ??= fromYear;
    }
    if (fromYear !== null && toYear !== null && (fromYear > toYear || fromYear < OLDEST_YEAR || toYear > last)) {
      ctx.addIssue({ code: 'custom', message: 'validation.fitment' });
      return z.NEVER;
    }
    return { ...ref, fromYear, toYear };
  });

/** A photo path this server stored, or an outside https URL (sample data). */
const image = z
  .string('validation.photos')
  .regex(/^(\/uploads\/parts\/[\w-]+\.(jpg|png|webp)|https:\/\/\S+)$/, 'validation.photos');

const optionalText = (max: number, key: 'validation.description' | 'validation.required') =>
  z
    .string()
    .trim()
    .max(max, key)
    .nullish()
    .transform((value) => (value ? value : null));

const fields = {
  name: z
    .string('validation.partName')
    .trim()
    .min(3, 'validation.partName')
    .max(100, 'validation.partName'),
  category: z.enum(PART_CATEGORIES, 'validation.category'),
  condition: z.enum(PART_CONDITIONS, 'validation.condition'),
  isOriginal: z.boolean().default(false),
  price: z
    .number('validation.price')
    .int('validation.price')
    .min(1, 'validation.price')
    .max(10_000_000, 'validation.price'),
  oldPrice: z
    .number('validation.price')
    .int('validation.price')
    .positive('validation.price')
    .nullish(),
  partNumber: optionalText(40, 'validation.required'),
  description: optionalText(1000, 'validation.description'),
  images: z.array(image, 'validation.photos').min(1, 'validation.photos'),
  fitments: z.array(fitment, 'validation.fitments').max(MAX_FITMENTS, 'validation.fitments'),
  fitsAllCars: z.boolean(),
  city: z.string('validation.city').refine(isGovernorate, 'validation.city'),
  phone,
};

const oldPriceAbovePrice = (value: { price?: number; oldPrice?: number | null }) =>
  value.oldPrice == null || value.price === undefined || value.oldPrice > value.price;

export const createPartSchema = z
  .strictObject({ ...fields, fitments: fields.fitments.default([]), fitsAllCars: fields.fitsAllCars.default(false) })
  .refine(oldPriceAbovePrice, { message: 'validation.oldPrice', path: ['oldPrice'] })
  // A part fits every car, or at least one make.
  .refine((value) => value.fitsAllCars || value.fitments.length > 0, {
    message: 'validation.fitments',
    path: ['fitments'],
  });

/** Edits send only what changed. */
export const updatePartSchema = z
  .strictObject(fields)
  .partial()
  .refine(oldPriceAbovePrice, { message: 'validation.oldPrice', path: ['oldPrice'] });

export const soldSchema = z.strictObject({ sold: z.boolean('validation.required') });

export const contactSchema = z.strictObject({
  channel: z.enum(['CALL', 'WHATSAPP'], 'validation.required'),
});

/**
 * `toyota:corolla:2016,hyundai:elantra:2015`. A typed make or model is its
 * name after `~`: `toyota:~كراون:1999`, `~بروتون:~ساجا:2004`.
 */
const cars = z.string().transform((value, ctx) => {
  const list = value
    .split(',')
    .filter(Boolean)
    .map((item) => {
      const [brand = '', model = '', year] = item.split(':');
      const typedBrand = brand.startsWith('~');
      const typedModel = model.startsWith('~');
      return {
        brandId: typedBrand ? 'other' : brand,
        brandKey: typedBrand ? carKey(brand.slice(1)) : null,
        modelId: typedModel ? null : model,
        modelKey: typedModel ? carKey(model.slice(1)) : null,
        year: Number(year),
      };
    });
  if (
    list.length > 5 ||
    list.some(
      (car) =>
        !car.brandId ||
        (car.brandId === 'other' && !car.brandKey) ||
        (!car.modelId && !car.modelKey) ||
        !Number.isInteger(car.year),
    )
  ) {
    ctx.addIssue({ code: 'custom', message: 'validation.query' });
    return z.NEVER;
  }
  return list;
});

const intParam = z.coerce
  .number('validation.query')
  .int('validation.query')
  .nonnegative('validation.query');

export const listQuerySchema = z.object({
  q: z.string().trim().max(100, 'validation.query').optional(),
  category: z.enum(PART_CATEGORIES, 'validation.query').optional(),
  condition: z.enum(PART_CONDITIONS, 'validation.query').optional(),
  origin: z.enum(['ORIGINAL', 'AFTERMARKET'], 'validation.query').optional(),
  city: z.string().optional(),
  minPrice: intParam.optional(),
  maxPrice: intParam.optional(),
  cars: cars.optional(),
  sort: z.enum(['NEWEST', 'PRICE_LOW', 'PRICE_HIGH'], 'validation.query').default('NEWEST'),
  sellerId: z
    .string()
    .regex(/^[0-9a-f]{24}$/, 'validation.query')
    .optional(),
  cursor: z.string().max(500, 'validation.query').optional(),
  limit: z.coerce
    .number('validation.query')
    .int('validation.query')
    .min(1, 'validation.query')
    .max(50, 'validation.query')
    .default(20),
});

export const featuredQuerySchema = z.object({
  condition: z.enum(PART_CONDITIONS, 'validation.query').optional(),
  cars: cars.optional(),
  limit: z.coerce
    .number('validation.query')
    .int('validation.query')
    .min(1, 'validation.query')
    .max(20, 'validation.query')
    .default(8),
});

/** `?ids=a,b,c`: parts the app knows by id (saved or recently viewed), at most 50. */
export const batchQuerySchema = z.object({
  ids: z
    .string('validation.required')
    .max(50 * 25, 'validation.query')
    .transform((value) => [...new Set(value.split(',').map((id) => id.trim()))].filter(Boolean))
    .refine((ids) => ids.length > 0 && ids.length <= 50, 'validation.query'),
});

/** The app's home screen: what it shows, narrowed to a condition and the user's cars. */
export const homeQuerySchema = z.object({
  condition: z.enum(PART_CONDITIONS, 'validation.query').optional(),
  cars: cars.optional(),
});

export const limitQuerySchema = z.object({
  limit: z.coerce
    .number('validation.query')
    .int('validation.query')
    .min(1, 'validation.query')
    .max(20, 'validation.query')
    .default(6),
});

export type CreatePartInput = z.infer<typeof createPartSchema>;
export type UpdatePartInput = z.infer<typeof updatePartSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type FeaturedQuery = z.infer<typeof featuredQuerySchema>;
export type HomeQuery = z.infer<typeof homeQuerySchema>;
export type CarQuery = NonNullable<ListQuery['cars']>;
