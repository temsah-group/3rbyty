import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import { ErrorCode, unavailable } from '../../common/http/errors.js';
import { send } from '../../common/http/response.js';
import { parseBody } from '../../common/http/validate.js';
import { logger } from '../../common/logger.js';
import { limit } from '../../middleware/rate-limit.js';
import { carBrands, PART_CATEGORIES, PART_CONDITIONS, type PartCategory, type PartCondition } from '../catalog/catalog.js';
import { carKey, OLDEST_YEAR, OTHER_BRAND } from '../catalog/car-ref.js';

/** A car as the seller said it: a make, maybe a model, maybe years. */
export type SpokenCar = { make: string; model: string | null; fromYear: number | null; toYear: number | null };

/** What a seller said about a part, sorted into the selling form's fields; null where they said nothing. */
export type SpokenListing = {
  name: string | null;
  category: PartCategory | null;
  condition: PartCondition | null;
  isOriginal: boolean | null;
  partNumber: string | null;
  price: number | null;
  description: string | null;
  fitsAllCars: boolean;
  cars: SpokenCar[];
};

export interface ListingReader {
  read(text: string): Promise<SpokenListing>;
}

const ListingSchema = z.object({
  name: z.string().nullable(),
  category: z.enum(PART_CATEGORIES).nullable(),
  condition: z.enum(PART_CONDITIONS).nullable(),
  isOriginal: z.boolean().nullable(),
  partNumber: z.string().nullable(),
  price: z.number().nullable(),
  description: z.string().nullable(),
  fitsAllCars: z.boolean(),
  cars: z.array(
    z.object({ make: z.string(), model: z.string().nullable(), fromYear: z.number().nullable(), toYear: z.number().nullable() }),
  ),
});

const PROMPT = `An Egyptian car spare-parts seller dictated this to list one part for sale (speech to text, Egyptian Arabic, may have small recognition mistakes). Sort it into the selling form:
- name: the part itself, short, as the seller would write it in Arabic (e.g. "مارش", "طقم تيل فرامل أمامي", "فانوس خلفي يمين"). No car names, condition, price or extra details in it.
- category: ENGINE (engine and its parts, cooling, belts, starter/alternator go to ELECTRICAL), BRAKES, SUSPENSION (عفشة: shocks, arms, bushings, steering), ELECTRICAL (كهرباء: starter مارش, alternator دينامو, sensors, batteries, wiring), BODY (صاج: doors, bumpers, mirrors, glass), LIGHTS (فوانيس), FILTERS (filters and oils), TYRES (tyres and rims). Null if unclear.
- condition: NEW (جديد), USED (مستعمل), IMPORTED (استيراد: used, imported from abroad). Null if not said.
- isOriginal: true for أصلي/original/وكالة, false for تجاري/aftermarket/كوبي; null if not said.
- partNumber: the part number if one was read out; else null.
- price: the asking price in Egyptian pounds as a whole number (e.g. "ألف وتمنمية" = 1800); null if not said.
- description: any other useful detail for a buyer (warranty, state, what is included), short, in Arabic; null if nothing.
- fitsAllCars: true only if the seller says it fits every car (يركب على كل العربيات).
- cars: each make (and model, if said) it fits. Write make and model the way they are usually written in English when they are known cars (Toyota, Corolla, Hyundai, Verna, Kia, Cerato, Chevrolet, Lanos, Nissan, Sunny, Renault, Logan, Mitsubishi, Lancer…), otherwise as said. fromYear/toYear for a range ("من 2014 لـ 2018"); one year said: both the same; none: null.
Do not guess what was not said.`;

/** Sorts a dictated listing into fields with Claude. */
export class ClaudeListingReader implements ListingReader {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  }

  async read(text: string): Promise<SpokenListing> {
    const response = await this.client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      // A short extraction someone is waiting on.
      output_config: { effort: 'low', format: betaZodOutputFormat(ListingSchema) },
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: text }],
    });
    const listing = response.stop_reason === 'refusal' ? null : response.parsed_output;
    if (!listing) {
      return { name: null, category: null, condition: null, isOriginal: null, partNumber: null, price: null, description: null, fitsAllCars: false, cars: [] };
    }
    return listing;
  }
}

/** A fitment for the selling form: a catalog make and model where the names match, else typed. */
export type FormFitment = {
  brandId: string;
  brandName: string | null;
  modelId: string | null;
  modelName: string | null;
  fromYear: number | null;
  toYear: number | null;
};

const year = (value: number | null, last: number) =>
  value !== null && Number.isInteger(value) && value >= OLDEST_YEAR && value <= last ? value : null;

/** [car] matched to the catalog by its Arabic or English names. */
export function fitmentOf(car: SpokenCar, now = new Date()): FormFitment | null {
  const make = car.make.trim();
  const makeKey = carKey(make);
  if (makeKey.length < 2) return null;
  const last = now.getUTCFullYear() + 1;
  let fromYear = year(car.fromYear, last);
  let toYear = year(car.toYear, last);
  if (fromYear !== null && toYear !== null && fromYear > toYear) [fromYear, toYear] = [toYear, fromYear];
  fromYear ??= toYear;
  toYear ??= fromYear;
  const named = (name: string) => [carKey(name)];
  const brand = carBrands().find((b) => [b.id, b.nameAr, b.nameEn].some((name) => named(name).includes(makeKey)));
  const modelName = car.model?.trim() || null;
  if (!brand) {
    return { brandId: OTHER_BRAND, brandName: make.slice(0, 40), modelId: null, modelName: modelName?.slice(0, 40) ?? null, fromYear: modelName ? fromYear : null, toYear: modelName ? toYear : null };
  }
  if (!modelName) return { brandId: brand.id, brandName: null, modelId: null, modelName: null, fromYear: null, toYear: null };
  const modelKey = carKey(modelName);
  const model = brand.models.find((m) => [m.id, m.nameAr, m.nameEn].some((name) => carKey(name) === modelKey));
  return model
    ? { brandId: brand.id, brandName: null, modelId: model.id, modelName: null, fromYear, toYear }
    : { brandId: brand.id, brandName: null, modelId: null, modelName: modelName.slice(0, 40), fromYear, toYear };
}

const input = z.strictObject({ text: z.string('validation.chat').trim().min(2, 'validation.chat').max(1000, 'validation.chat') });

/**
 * `POST /listing-from-speech`: what a seller said about a part in, the selling
 * form's fields out (the seller checks them before publishing). Signed-in
 * sellers only, a few times a minute.
 */
export function voiceListingRoutes(reader: ListingReader | null, requireAuth: RequestHandler): Router {
  const router = Router();
  router.post('/', requireAuth, limit({ max: 20, windowMs: 10 * 60_000 }), async (req, res) => {
    if (!reader) throw unavailable(ErrorCode.VOICE_LISTING_OFF, 'voiceListing.off');
    const { text } = parseBody(input, req);
    let spoken: SpokenListing;
    try {
      spoken = await reader.read(text);
    } catch (error) {
      logger.warn('Reading a spoken listing failed', { error: error instanceof Error ? error.message : String(error) });
      throw unavailable(ErrorCode.VOICE_LISTING_FAILED, 'voiceListing.failed');
    }
    const price = spoken.price !== null && spoken.price >= 1 && spoken.price <= 10_000_000 ? Math.round(spoken.price) : null;
    const fitments = spoken.fitsAllCars ? [] : spoken.cars.map((car) => fitmentOf(car)).filter((f): f is FormFitment => f !== null).slice(0, 20);
    send(res, {
      data: {
        name: spoken.name?.trim().slice(0, 100) || null,
        category: spoken.category,
        condition: spoken.condition,
        isOriginal: spoken.isOriginal,
        partNumber: spoken.partNumber?.trim().slice(0, 40) || null,
        price,
        description: spoken.description?.trim().slice(0, 1000) || null,
        fitsAllCars: spoken.fitsAllCars,
        fitments,
      },
    });
  });
  return router;
}
