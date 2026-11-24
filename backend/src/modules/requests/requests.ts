import { Router, type RequestHandler } from 'express';
import { Schema, Types, type Connection, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import { z } from 'zod';

import { badRequest, ErrorCode, forbidden, notFound, tooManyRequests } from '../../common/http/errors.js';
import { send } from '../../common/http/response.js';
import { parseBody } from '../../common/http/validate.js';
import { limit } from '../../middleware/rate-limit.js';
import { OTHER_BRAND, resolveCar, yearFits } from '../catalog/car-ref.js';
import { isGovernorate, PART_CATEGORIES, PART_CONDITIONS } from '../catalog/catalog.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { OPEN_SHOP, type ShopModel } from '../shops/shop.model.js';

/**
 * "Ask for a part": a buyer says what they need (the part, the car, the
 * governorate) and the shops that carry that make there hear of it and answer
 * with a price. The buyer sees the answers and calls or messages the shop;
 * the buyer's own number is never shown to shops.
 */

/** A request is answered for this long, then closes by itself. */
export const REQUEST_DAYS = 14;
/** Open requests one buyer may have at a time. */
export const MAX_OPEN_REQUESTS = 5;
/** Shops told of one request at most. */
const MAX_SHOPS_TOLD = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const carSchema = new Schema(
  {
    brandId: { type: String, required: true },
    brandName: { type: String, default: null },
    brandKey: { type: String, default: null },
    modelId: { type: String, default: null },
    modelName: { type: String, default: null },
    modelKey: { type: String, default: null },
    year: { type: Number, default: null },
  },
  { _id: false },
);

const requestSchema = new Schema(
  {
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    partName: { type: String, required: true, trim: true, maxlength: 100 },
    category: { type: String, enum: [...PART_CATEGORIES, null], default: null },
    car: { type: carSchema, required: true },
    /** Where the buyer wants it; null: anywhere, every shop in Egypt is told. */
    city: { type: String, default: null },
    note: { type: String, default: null },
    /** Set when the buyer closes it (found the part); it also closes after [REQUEST_DAYS]. */
    closedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    replyCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'part_requests' },
);
requestSchema.index({ buyerId: 1, createdAt: -1 });
requestSchema.index({ closedAt: 1, expiresAt: 1, createdAt: -1 });
requestSchema.index({ 'car.brandId': 1, city: 1, createdAt: -1 });

const replySchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'PartRequest', required: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** null: "I have it", the price on the phone. */
    price: { type: Number, default: null },
    condition: { type: String, enum: PART_CONDITIONS, required: true },
    isOriginal: { type: Boolean, default: false },
    note: { type: String, default: null },
  },
  { timestamps: true, collection: 'part_request_replies' },
);
// One answer per shop per request; answering again changes it.
replySchema.index({ requestId: 1, shopId: 1 }, { unique: true });
replySchema.index({ shopId: 1, createdAt: -1 });

export type PartRequest = InferSchemaType<typeof requestSchema>;
export type PartRequestDocument = HydratedDocument<PartRequest>;
export type PartRequestModel = Model<PartRequest>;
export type RequestReply = InferSchemaType<typeof replySchema>;
export type RequestReplyModel = Model<RequestReply>;

export const createPartRequestModel = (connection: Connection): PartRequestModel =>
  connection.model<PartRequest>('PartRequest', requestSchema);
export const createRequestReplyModel = (connection: Connection): RequestReplyModel =>
  connection.model<RequestReply>('RequestReply', replySchema);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'validation.description')
    .nullish()
    .transform((value) => value || null);

export const requestInputSchema = z.strictObject({
  partName: z.string('validation.partName').trim().min(3, 'validation.partName').max(100, 'validation.partName'),
  category: z.enum(PART_CATEGORIES, 'validation.category').nullish().transform((value) => value ?? null),
  car: z
    .strictObject({
      brandId: z.string('validation.car'),
      brandName: z.string('validation.car').max(60, 'validation.car').nullish(),
      modelId: z.string('validation.car').nullish(),
      modelName: z.string('validation.car').max(60, 'validation.car').nullish(),
      year: z.number('validation.car').int('validation.car').nullish(),
    })
    .transform((value, ctx) => {
      const car = resolveCar(value);
      if (!car || (value.year != null && !yearFits(car.model, value.year))) {
        ctx.addIssue({ code: 'custom', message: 'validation.car' });
        return z.NEVER;
      }
      const { model: _model, ...ref } = car;
      return { ...ref, year: value.year ?? null };
    }),
  city: z.string('validation.city').refine(isGovernorate, 'validation.city').nullish().transform((city) => city ?? null),
  note: optionalText(300),
});
export type RequestInput = z.infer<typeof requestInputSchema>;

export const replyInputSchema = z.strictObject({
  price: z.number('validation.price').int('validation.price').min(1, 'validation.price').max(10_000_000, 'validation.price').nullish().transform((price) => price ?? null),
  condition: z.enum(PART_CONDITIONS, 'validation.condition'),
  isOriginal: z.boolean().default(false),
  note: optionalText(300),
});
export type ReplyInput = z.infer<typeof replyInputSchema>;

const isOpen = (request: PartRequest) => !request.closedAt && request.expiresAt.getTime() > Date.now();
const OPEN_NOW = () => ({ closedAt: null, expiresAt: { $gt: new Date() } });

type ShopDoc = InstanceType<ShopModel>;

/** Whether [shop] carries what [request] asks for, where it is asked. */
function shopMatches(shop: ShopDoc, request: PartRequest): boolean {
  const brands = shop.brandIds ?? [];
  const makeOk = request.car.brandId === OTHER_BRAND || brands.length === 0 || brands.includes(request.car.brandId);
  const categories = (shop.categories ?? []) as string[];
  const categoryOk = !request.category || categories.length === 0 || categories.includes(request.category);
  const delivery = shop.delivery;
  const placeOk = !request.city || shop.city === request.city || Boolean(delivery?.available && delivery.governorates?.includes(request.city));
  return makeOk && categoryOk && placeOk;
}

/** The database filter for the shops [request] is told to. */
function matchingShops(request: PartRequest) {
  return {
    ...OPEN_SHOP,
    $and: [
      request.car.brandId === OTHER_BRAND ? {} : { $or: [{ brandIds: { $size: 0 } }, { brandIds: request.car.brandId }] },
      request.category ? { $or: [{ categories: { $size: 0 } }, { categories: request.category }] } : {},
      request.city ? { $or: [{ city: request.city }, { 'delivery.available': true, 'delivery.governorates': request.city }] } : {},
    ],
  };
}

function presentRequest(request: PartRequestDocument) {
  const car = request.car;
  return {
    id: request.id as string,
    partName: request.partName,
    category: request.category ?? null,
    car: {
      brandId: car.brandId,
      brandName: car.brandName ?? null,
      modelId: car.modelId ?? null,
      modelName: car.modelName ?? null,
      year: car.year ?? null,
    },
    city: request.city ?? null,
    note: request.note ?? null,
    open: isOpen(request),
    replyCount: request.replyCount ?? 0,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  };
}

export class RequestsService {
  constructor(
    private readonly deps: {
      requests: PartRequestModel;
      replies: RequestReplyModel;
      shops: ShopModel;
      notifications: Pick<NotificationsService, 'requestNotice'>;
    },
  ) {}

  /** A new request, told to the shops that carry the make in that governorate, or anywhere when none is given. */
  async create(buyerId: string, input: RequestInput) {
    const buyer = new Types.ObjectId(buyerId);
    const open = await this.deps.requests.countDocuments({ buyerId: buyer, ...OPEN_NOW() }).exec();
    if (open >= MAX_OPEN_REQUESTS) {
      throw tooManyRequests(ErrorCode.TOO_MANY_REQUESTS, 'requests.tooMany', [MAX_OPEN_REQUESTS]);
    }
    const request = await this.deps.requests.create({
      ...input,
      buyerId: buyer,
      expiresAt: new Date(Date.now() + REQUEST_DAYS * DAY_MS),
    });
    const shops = await this.deps.shops
      .find({ ...matchingShops(request), ownerId: { $ne: buyer } })
      .select('ownerId')
      .limit(MAX_SHOPS_TOLD)
      .lean()
      .exec();
    await this.deps.notifications.requestNotice(
      shops.map((shop) => shop.ownerId as Types.ObjectId),
      'NEW',
      request._id,
      [request.partName],
    );
    return presentRequest(request);
  }

  /** The buyer's requests, newest first, with how many shops answered. */
  async mine(buyerId: string) {
    const list = await this.deps.requests.find({ buyerId: new Types.ObjectId(buyerId) }).sort({ createdAt: -1 }).limit(50).exec();
    return { items: list.map(presentRequest) };
  }

  /**
   * One request: its buyer sees every answer with the shop's name and number;
   * a shop it was meant for sees the request and its own answer.
   */
  async byId(userId: string, id: string) {
    const request = await this.find(id);
    if (request.buyerId.toString() === userId) {
      // Cheapest first; the answers without a price after them.
      const replies = (await this.deps.replies.find({ requestId: request._id }).sort({ price: 1, createdAt: 1 }).lean().exec()).sort((a, b) => Number(a.price == null) - Number(b.price == null));
      const shops = await this.deps.shops.find({ _id: { $in: replies.map((r) => r.shopId) }, ...OPEN_SHOP }).lean().exec();
      const byId = new Map(shops.map((shop) => [shop._id.toString(), shop]));
      return {
        ...presentRequest(request),
        mine: true,
        replies: replies
          .filter((reply) => byId.has(reply.shopId.toString()))
          .map((reply) => {
            const shop = byId.get(reply.shopId.toString())!;
            return {
              id: reply._id.toString(),
              price: reply.price ?? null,
              condition: reply.condition,
              isOriginal: reply.isOriginal,
              note: reply.note ?? null,
              createdAt: reply.createdAt,
              shop: {
                id: shop._id.toString(),
                name: shop.name,
                logoUrl: shop.logoUrl ?? null,
                verified: Boolean(shop.isVerified),
                city: shop.city,
                phone: shop.phone,
                whatsapp: shop.whatsapp ?? null,
                rating: { avg: shop.rating?.avg ?? 0, count: shop.rating?.count ?? 0 },
              },
            };
          }),
      };
    }
    const shop = await this.openShopOf(userId);
    if (!shop || !shopMatches(shop, request)) throw notFound('requests.notFound');
    const reply = await this.deps.replies.findOne({ requestId: request._id, shopId: shop._id }).lean().exec();
    return { ...presentRequest(request), mine: false, myReply: reply ? { price: reply.price ?? null, condition: reply.condition, isOriginal: reply.isOriginal, note: reply.note ?? null } : null };
  }

  async close(buyerId: string, id: string) {
    const request = await this.find(id);
    if (request.buyerId.toString() !== buyerId) throw notFound('requests.notFound');
    request.closedAt ??= new Date();
    await request.save();
    return presentRequest(request);
  }

  /** The open requests a shop could answer, newest first, with its own answer if any. */
  async inbox(userId: string) {
    const shop = await this.openShopOf(userId);
    if (!shop) throw forbidden(ErrorCode.SHOP_REQUIRED, 'requests.shopRequired');
    const brands = shop.brandIds ?? [];
    const categories = (shop.categories ?? []) as string[];
    const places = [shop.city, ...(shop.delivery?.available ? (shop.delivery.governorates ?? []) : [])];
    const filter: Record<string, unknown> = {
      ...OPEN_NOW(),
      buyerId: { $ne: shop.ownerId },
      // Asked in a place it sells to, or anywhere.
      city: { $in: [...places, null] },
      ...(brands.length ? { 'car.brandId': { $in: [...brands, OTHER_BRAND] } } : {}),
      ...(categories.length ? { category: { $in: [...categories, null] } } : {}),
    };
    const list = await this.deps.requests
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();
    const replies = await this.deps.replies.find({ shopId: shop._id, requestId: { $in: list.map((r) => r._id) } }).lean().exec();
    const answered = new Map(replies.map((reply) => [reply.requestId.toString(), reply]));
    return {
      items: list.map((request) => {
        const reply = answered.get(request.id as string);
        return { ...presentRequest(request), myReply: reply ? { price: reply.price ?? null, condition: reply.condition, isOriginal: reply.isOriginal, note: reply.note ?? null } : null };
      }),
    };
  }

  /** A shop's answer to a request: given once, changed after; the buyer hears of the first. */
  async reply(userId: string, id: string, input: ReplyInput) {
    const request = await this.find(id);
    if (!isOpen(request)) throw badRequest(ErrorCode.REQUEST_CLOSED, 'requests.closed');
    const shop = await this.openShopOf(userId);
    if (!shop) throw forbidden(ErrorCode.SHOP_REQUIRED, 'requests.shopRequired');
    if (!shopMatches(shop, request) || request.buyerId.equals(shop.ownerId)) throw notFound('requests.notFound');
    const before = await this.deps.replies
      .findOneAndUpdate(
        { requestId: request._id, shopId: shop._id },
        { $set: { ...input, sellerId: shop.ownerId }, $setOnInsert: { requestId: request._id, shopId: shop._id } },
        { upsert: true, new: false },
      )
      .exec();
    if (!before) {
      await this.deps.requests.updateOne({ _id: request._id }, { $inc: { replyCount: 1 } }).exec();
      await this.deps.notifications.requestNotice([request.buyerId], 'REPLY', request._id, [shop.name, input.price == null ? '' : String(input.price), request.partName]);
    }
    return { price: input.price, condition: input.condition, isOriginal: input.isOriginal, note: input.note };
  }

  /** A deleted account's requests and answers go with it. */
  async deleteAllOf(userId: string): Promise<void> {
    const owner = new Types.ObjectId(userId);
    const mine = await this.deps.requests.find({ buyerId: owner }).select('_id').lean().exec();
    await Promise.all([
      this.deps.replies.deleteMany({ $or: [{ requestId: { $in: mine.map((r) => r._id) } }, { sellerId: owner }] }).exec(),
      this.deps.requests.deleteMany({ buyerId: owner }).exec(),
    ]);
  }

  private async find(id: string): Promise<PartRequestDocument> {
    if (!Types.ObjectId.isValid(id)) throw notFound('requests.notFound');
    const request = await this.deps.requests.findById(id).exec();
    if (!request) throw notFound('requests.notFound');
    return request;
  }

  private openShopOf(userId: string) {
    return this.deps.shops.findOne({ ownerId: new Types.ObjectId(userId), ...OPEN_SHOP }).exec();
  }
}

/** `/requests` in the app's API. */
export function requestsRoutes(requests: RequestsService, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);
  router.post('/', limit({ max: 10, windowMs: 60 * 60_000 }), async (req, res) => {
    send(res, { status: 201, message: 'requests.created', data: await requests.create(req.auth!.userId, parseBody(requestInputSchema, req)) });
  });
  router.get('/mine', async (req, res) => {
    send(res, { data: await requests.mine(req.auth!.userId) });
  });
  // Before `/:id`.
  router.get('/inbox', async (req, res) => {
    send(res, { data: await requests.inbox(req.auth!.userId) });
  });
  router.get('/:id', async (req, res) => {
    send(res, { data: await requests.byId(req.auth!.userId, String(req.params.id)) });
  });
  router.post('/:id/close', async (req, res) => {
    send(res, { data: await requests.close(req.auth!.userId, String(req.params.id)) });
  });
  router.post('/:id/replies', limit({ max: 60 }), async (req, res) => {
    send(res, { message: 'requests.replied', data: await requests.reply(req.auth!.userId, String(req.params.id), parseBody(replyInputSchema, req)) });
  });
  return router;
}
