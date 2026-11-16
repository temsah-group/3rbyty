import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import { badRequest, ErrorCode, unavailable } from '../../common/http/errors.js';
import { send } from '../../common/http/response.js';
import { logger } from '../../common/logger.js';
import { limit } from '../../middleware/rate-limit.js';
import governorates from '../catalog/governorates.json' with { type: 'json' };
import { photoExtension } from '../users/photo-storage.js';
import { photoUpload } from '../users/users.routes.js';

/** What a business card says, for the shop sign-up form; null where it says nothing. */
export type CardDetails = {
  shopName: string | null;
  /** As printed; the form turns it into a number it accepts. */
  phone: string | null;
  /** One of the governorates, by its Arabic name. */
  city: string | null;
  address: string | null;
};

export interface CardScanner {
  scan(image: Buffer, mediaType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<CardDetails>;
}

const CardSchema = z.object({
  shopName: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.enum(governorates as [string, ...string[]]).nullable(),
  address: z.string().nullable(),
});

const PROMPT = `This is a photo of an Egyptian car spare-parts shop's business card. Read it and fill in:
- shopName: the shop's name as written (Arabic if the card has it), without slogans or the owner's title.
- phone: the main mobile number, written with the digits 0-9 even if the card uses Arabic-Indic digits (an Egyptian mobile starts with 01 and has 11 digits). If there are several, prefer a mobile over a landline.
- city: the governorate the shop is in, from the allowed list, judged from the address. Null if the card does not say.
- address: the street address as written, without the governorate name.
Use null for anything the card does not show. Do not guess or invent details.`;

/** Reads business cards with Claude. */
export class ClaudeCardScanner implements CardScanner {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  }

  async scan(image: Buffer, mediaType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<CardDetails> {
    const response = await this.client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      // A short extraction someone is waiting on.
      output_config: { effort: 'low', format: betaZodOutputFormat(CardSchema) },
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return { shopName: null, phone: null, city: null, address: null };
    }
    const card = response.parsed_output;
    const clean = (value: string | null) => value?.trim() || null;
    return {
      shopName: clean(card.shopName)?.slice(0, 60) ?? null,
      phone: clean(card.phone),
      city: card.city,
      address: clean(card.address)?.slice(0, 200) ?? null,
    };
  }
}

const MEDIA_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

/**
 * `POST /auth/scan-card`: a photo of a shop's business card in, the sign-up
 * form's details out. Public (it comes before the account exists), so it is
 * held to a few photos per visitor.
 */
export function cardScanRoutes(scanner: CardScanner | null): Router {
  const router = Router();
  router.post('/', limit({ max: 5, windowMs: 10 * 60_000 }), photoUpload as RequestHandler, async (req, res) => {
    if (!scanner) throw unavailable(ErrorCode.CARD_SCAN_OFF, 'cardScan.off');
    const file = req.file;
    if (!file) throw badRequest(ErrorCode.PHOTO_REQUIRED, 'users.photoRequired');
    const extension = photoExtension(file.buffer);
    if (!extension) throw badRequest(ErrorCode.PHOTO_INVALID, 'users.photoInvalid');
    try {
      send(res, { data: await scanner.scan(file.buffer, MEDIA_TYPES[extension]) });
    } catch (error) {
      logger.warn('Business card scan failed', { error: error instanceof Error ? error.message : String(error) });
      throw unavailable(ErrorCode.CARD_SCAN_FAILED, 'cardScan.failed');
    }
  });
  return router;
}
