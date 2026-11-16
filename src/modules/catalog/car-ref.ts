import { findBrand, findModel, modelYears, normalizeSearchText, type CarModel } from './catalog.js';

/**
 * A car as people name it: a make and model from the catalog, or, when theirs
 * is not listed, a make or model typed by hand. Typed names are matched by
 * their [carKey], so "كراون" typed by a shop finds the buyer who typed "كراون".
 */

/** The make id for a make typed by hand. */
export const OTHER_BRAND = 'other';
/** Year lists start here, even for models the catalog has from a later year. */
export const LIST_FROM_YEAR = 1998;
/** The oldest year anyone can type. */
export const OLDEST_YEAR = 1950;

/** A typed name reduced to what matches: no case, spaces, punctuation or letter-form differences. */
export const carKey = (name: string) => normalizeSearchText(name).replace(/[^\p{L}\p{N}]/gu, '');

/** A typed name tidied for showing: no separators the search link uses, at most 40 characters. */
const tidyName = (name: string | null | undefined) => name?.replace(/[:,~]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || null;

export type CarRef = {
  brandId: string;
  brandName: string | null;
  brandKey: string | null;
  modelId: string | null;
  modelName: string | null;
  modelKey: string | null;
};

/** The last year a car can be: the model's last year, or next year's models for a typed one. */
export function lastYear(model: CarModel | undefined, now = new Date()): number {
  return model ? modelYears(model, now)[1] : now.getUTCFullYear() + 1;
}

/** The years offered in lists: from 1998 (or the model's first year, if older) to its last. */
export function listYears(model: CarModel, now = new Date()): [number, number] {
  return [Math.min(model.fromYear, LIST_FROM_YEAR), lastYear(model, now)];
}

/** A year someone may give for [model]: listed, or typed back to 1950. */
export function yearFits(model: CarModel | undefined, year: number): boolean {
  return Number.isInteger(year) && year >= OLDEST_YEAR && year <= lastYear(model);
}

/**
 * Checks and completes a make and model as sent: a catalog make with a
 * catalog model, a typed model, or no model; or a typed make (`other`) with a
 * typed model or none. Null when it names nothing valid.
 */
export function resolveCar(input: {
  brandId: string;
  brandName?: string | null;
  modelId?: string | null;
  modelName?: string | null;
}): (CarRef & { model?: CarModel }) | null {
  const brandName = tidyName(input.brandName);
  const modelName = tidyName(input.modelName);
  if (input.brandId === OTHER_BRAND) {
    if (!brandName || carKey(brandName).length < 2) return null;
    return {
      brandId: OTHER_BRAND,
      brandName,
      brandKey: carKey(brandName),
      modelId: null,
      modelName,
      modelKey: modelName ? carKey(modelName) || null : null,
    };
  }
  if (!findBrand(input.brandId)) return null;
  if (input.modelId) {
    const model = findModel(input.brandId, input.modelId);
    if (!model) return null;
    return { brandId: input.brandId, brandName: null, brandKey: null, modelId: model.id, modelName: null, modelKey: null, model };
  }
  return {
    brandId: input.brandId,
    brandName: null,
    brandKey: null,
    modelId: null,
    modelName,
    modelKey: modelName ? carKey(modelName) || null : null,
  };
}

/** How a car names its make in a database query. */
export const brandMatch = (car: { brandId: string; brandKey?: string | null }) =>
  car.brandId === OTHER_BRAND && car.brandKey ? { brandId: OTHER_BRAND, brandKey: car.brandKey } : { brandId: car.brandId };

/** The keys a catalog model also goes by when someone types its name. */
export function modelKeys(brandId: string, modelId: string): string[] {
  const model = findModel(brandId, modelId);
  return model ? [...new Set([carKey(model.nameAr), carKey(model.nameEn)].filter(Boolean))] : [];
}
