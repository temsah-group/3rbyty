import Anthropic from '@anthropic-ai/sdk';
import { Router } from 'express';
import { z } from 'zod';

import { ErrorCode, unavailable } from '../../common/http/errors.js';
import { send } from '../../common/http/response.js';
import { parseBody } from '../../common/http/validate.js';
import { logger } from '../../common/logger.js';
import { limit } from '../../middleware/rate-limit.js';

/** One line of the chat, as the website keeps it. */
export type ChatLine = { role: 'user' | 'assistant'; content: string };

/** What the help answers are written from: the FAQ and support details, as the dashboard has them now. */
export type SiteFacts = {
  faq: { title: string; body: string }[];
  support: { email: string; phone: string; whatsapp: string } | null;
};

export interface Assistant {
  reply(lines: ChatLine[], facts: SiteFacts): Promise<string>;
}

/**
 * The guide the assistant answers from. Only what the site really does:
 * anything it doesn't cover, the assistant says so and points to support.
 */
const GUIDE = `You are the help assistant on عربيتي (3arabity, 3rbyty.com), an Egyptian website for buying and selling car spare parts: new, used and imported, from individual sellers and from shops all over Egypt.

## How to answer
- Reply in the visitor's language: Egyptian Arabic (عامية مصرية, friendly and simple) by default, English if they write in English.
- Keep it short: 1 to 4 sentences, or a few short steps. No headings, no tables.
- Only answer from the facts below. If the answer is not here (a part's price or availability, a specific seller, delivery times, legal or mechanical advice), say you don't know and point to the right page or to support. Never invent features, prices, fees or policies.
- Link to pages of the site with Markdown links using these paths only: [بيع قطعة](/sell), [دوّر على قطع](/search), [المحلات](/shops), [اطلب قطعة](/requests/new), [طلباتي](/account/requests), [حسابي](/account), [قطعي المعروضة](/account/parts), [محلي](/account/shop), [المحفوظات](/saved), [الإشعارات](/notifications), [نزّل التطبيق](/app), [المساعدة](/help), [اعمل حساب](/register), [تسجيل الدخول](/login), [نسيت كلمة السر](/forgot-password), [شروط الاستخدام](/legal/terms), [الخصوصية](/legal/privacy). Use the link text in the visitor's language.
- You can't see the visitor's account, listings or messages, and you can't do anything for them: tell them where to do it.
- Off-topic questions: answer in one polite line that you only help with the site.

## Facts about the site
Buying
- Search by part name, part number or car from [دوّر على قطع](/search), with filters (category, condition, governorate, price). Pick your car at the top of the home page and part pages say whether a part fits it.
- On a part's page, call or WhatsApp the seller. Price, inspection, handover and payment are agreed directly between buyer and seller; the site takes no payment and is not a party to the sale.
- Save parts and shops with the heart to find them later in [المحفوظات](/saved); you get a notification if a saved part's price drops.
- Add your cars in your account to get notified when a part for your car is listed.
- Safety: inspect before paying, meet in a public place, never send money in advance to someone you don't know, and report a suspicious listing or seller from its page.

Can't find a part: اطلب قطعة
- From [اطلب قطعة](/requests/new) (also offered on the home page and when a search finds nothing): write the part, pick the car (or type it if it's not listed), optionally a category, and the governorate.
- Shops that carry that make, in that governorate or delivering there, get notified and reply with a price, condition and a note. Replies show cheapest first in [طلباتي](/account/requests), each with call and WhatsApp buttons. The buyer's phone number is not shown to shops; the buyer contacts the shop they choose.
- Up to 5 open requests at a time; a request stays open 14 days, and the buyer can close it once they found the part.

Selling
- Using the site and listing parts is free.
- Tap + in the middle of the bottom bar (or [بيع قطعة](/sell)): photos, name, category, condition, price, and the cars it fits (a make only, specific models and years, or "all cars"; cars not in the list can be typed). It is published right away.
- Manage listings in [قطعي المعروضة](/account/parts): edit, copy a listing to add a similar one quickly, or mark it "اتباعت" (sold) so it disappears for buyers; it can be shown again later.
- The site's team can hide listings that break the [شروط الاستخدام](/legal/terms).

Shops (محلات)
- At sign-up choose "محل" instead of individual, and enter the shop's name, governorate and address; a photo of the business card can fill these in. The shop is created when the email is verified, and the site's team reviews it before it shows publicly.
- In [محلي](/account/shop): phone, WhatsApp, hours, the makes and categories the shop works on ("select all" exists), delivery and the governorates it delivers to, logo and cover photo.
- Shops have a public page with their parts and reviews, appear under [المحلات](/shops), and get buyers' part requests for their makes under "طلبات المشترين" in their account.
- Selling form for shops: one page, with the shop's details filled in, and it keeps the fields between consecutive parts.

Account
- Sign up with email (a verification code is emailed) or Google. You stay signed in for 7 days since your last visit, or 30 days with "افتكرني".
- Forgot your password: [نسيت كلمة السر](/forgot-password). Change details, password, notification settings or delete the account from [حسابي](/account).

The app
- 3arabity has no app store app: it installs from the browser onto the home screen and opens like an app. Steps for Android and iPhone are on [نزّل التطبيق](/app). Browser notifications can be turned on from notification settings.`;

/** Answers visitors' questions about the site with Claude. */
export class ClaudeAssistant implements Assistant {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  }

  async reply(lines: ChatLine[], facts: SiteFacts): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      // Quick answers from a fixed guide.
      output_config: { effort: 'low' },
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        // The fixed guide first and cached; the dashboard's FAQ and support after it.
        { type: 'text', text: GUIDE, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: siteFactsText(facts) },
      ],
      messages: lines.map((line) => ({ role: line.role, content: line.content })),
    });
    if (response.stop_reason === 'refusal') return '';
    return response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
  }
}

function siteFactsText({ faq, support }: SiteFacts): string {
  const questions = faq.map((item) => `Q: ${item.title}\nA: ${item.body}`).join('\n\n');
  const contact = support
    ? `Support: WhatsApp ${support.whatsapp}, phone ${support.phone}, email ${support.email}. Offer it when you can't help.`
    : 'There is no support contact to give: point to [المساعدة](/help) when you can\'t help.';
  return `## The site's FAQ (as published on /help)\n${questions}\n\n## Support\n${contact}`;
}

const chatInput = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        content: z.string('validation.chat').trim().min(1, 'validation.chat').max(1000, 'validation.chat'),
      }),
      'validation.chat',
    )
    .min(1, 'validation.chat')
    .max(12, 'validation.chat')
    // A conversation starts and ends with the visitor.
    .refine((lines) => lines[0]?.role === 'user' && lines.at(-1)?.role === 'user', 'validation.chat'),
});

/**
 * `POST /assistant`: the conversation so far in (the last few lines), the
 * next answer out. Public, and held to a few questions per visitor. Whether
 * it is on comes with the app config (`features.assistant`).
 */
export function assistantRoutes(assistant: Assistant | null, facts: () => Promise<SiteFacts>): Router {
  const router = Router();
  router.post('/', limit({ max: 15, windowMs: 10 * 60_000 }), limit({ max: 60, windowMs: 24 * 60 * 60_000 }), async (req, res) => {
    if (!assistant) throw unavailable(ErrorCode.ASSISTANT_OFF, 'assistant.off');
    const { messages } = parseBody(chatInput, req);
    // The visitor's own question is the last line; at most the line limit is kept.
    const lines = messages.slice(-12).map((line) => ({ ...line, content: line.content.slice(0, line.role === 'user' ? 500 : 1000) }));
    let reply = '';
    try {
      reply = await assistant.reply(lines, await facts());
    } catch (error) {
      logger.warn('Assistant reply failed', { error: error instanceof Error ? error.message : String(error) });
      throw unavailable(ErrorCode.ASSISTANT_FAILED, 'assistant.failed');
    }
    send(res, { data: { reply: reply || null } });
  });
  return router;
}
