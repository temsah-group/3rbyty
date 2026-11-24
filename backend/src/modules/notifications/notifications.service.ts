import { brandMatch } from '../catalog/car-ref.js';
import { Types, type QueryFilter } from 'mongoose';

import { notFound } from '../../common/http/errors.js';
import { afterCursor, nextCursorOf } from '../../common/http/paging.js';
import { t, type Lang } from '../../common/i18n.js';
import { logger } from '../../common/logger.js';
import type { PartDocument } from '../parts/part.model.js';
import type { ReviewDocument } from '../reviews/review.model.js';
import type { ReviewEvent } from '../reviews/reviews.service.js';
import type { SavedPartModel } from '../saved/saved.model.js';
import type { User, UserModel } from '../users/user.model.js';
import type {
  DeviceModel,
  Notification,
  NotificationDocument,
  NotificationKind,
  NotificationModel,
} from './notification.model.js';
import type { PushMessage, PushSender } from './push.js';
import type { Mailer } from '../mail/mailer.js';
import { AccountStatus } from '../users/user.model.js';
import {
  digestEmail,
  EMAIL_DIGEST,
  EMAIL_NOW,
  emailOffUrl,
  emailOffValid,
  notificationEmail,
  type EmailItem,
} from './email.js';

/** What happened to a listing; the first param of a `LISTING` notification. */
export type ListingChange = 'HIDDEN' | 'RESTORED' | 'REMOVED';

/** What a moderator did to a shop; the first param of a `SHOP` notification. */
export type ShopChange =
  | 'APPROVED'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'RESTORED'
  | 'VERIFIED'
  | 'FEATURED';

/** What a moderator did to an account; the first param of an `ACCOUNT` notification. */
export type AccountChange = 'VERIFIED' | 'RESTORED';

export type NotificationSettings = { fitsMyCar: boolean; priceDrops: boolean; news: boolean; email: boolean };

/** How notifications go out by email; without it, they don't. */
export type EmailChannel = {
  mailer: Mailer;
  /** The website, for links in the emails. */
  siteUrl: string;
  apiPrefix: string;
  /** Signs each user's "stop these emails" link. */
  secret: string;
  /** Emails a day at most, under what the mail host allows; the rest wait. */
  dailyLimit: number;
};

/** A user hears about part requests by email at most this often; the rest go in the daily summary. */
const REQUEST_EMAIL_GAP_MS = 30 * 60_000;
/** The daily summary goes out at this hour, Cairo time, and covers about the last day and a half. */
const DIGEST_HOUR = 10;
const DIGEST_WINDOW_MS = 36 * 60 * 60_000;

/** How many users one new part may notify; the rest miss out, the app goes on. */
const MAX_RECIPIENTS = 2000;

const money = (value: number) => new Intl.NumberFormat('en-US').format(value);

/**
 * The inbox, what the user wants in it, and the phones push goes to. Parts
 * call [partListed] and [priceDropped]; everything put in an inbox is also
 * pushed to that user's phones, after the request that caused it.
 */
export class NotificationsService {
  constructor(
    private readonly notifications: NotificationModel,
    private readonly devices: DeviceModel,
    private readonly users: UserModel,
    private readonly saved: SavedPartModel,
    private readonly push: PushSender,
    private readonly email: EmailChannel | null = null,
  ) {}

  /** Emails sent today (Cairo), against [EmailChannel.dailyLimit]. */
  private emailed = { day: '', count: 0 };
  private lastDigestDay = '';

  /** Pushes still going out; tests wait on them with [flush]. */
  private readonly sending = new Set<Promise<void>>();

  // ---- The inbox ----

  async list(userId: string, lang: Lang, cursor: string | undefined, limit: number) {
    const owner = new Types.ObjectId(userId);
    const [found, unreadCount] = await Promise.all([
      this.notifications
        .find({ userId: owner, ...afterCursor('createdAt', cursor) })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .exec(),
      this.notifications.countDocuments({ userId: owner, read: false }).exec(),
    ]);
    return {
      items: found.slice(0, limit).map((item) => present(item, lang)),
      nextCursor: nextCursorOf(found, limit, 'createdAt'),
      unreadCount,
    };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const result = await this.notifications
      .updateOne(this.mine(userId, id), { $set: { read: true } })
      .exec();
    if (result.matchedCount === 0) throw notFound('notifications.notFound');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notifications
      .updateMany({ userId: new Types.ObjectId(userId), read: false }, { $set: { read: true } })
      .exec();
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.notifications.deleteOne(this.mine(userId, id)).exec();
    if (result.deletedCount === 0) throw notFound('notifications.notFound');
  }

  // ---- Settings and devices ----

  async settings(userId: string): Promise<NotificationSettings> {
    const user = await this.users.findById(userId).select('notificationSettings').exec();
    return settingsOf(user);
  }

  /** Older apps don't send [email]: it stays as it was. */
  async updateSettings(
    userId: string,
    input: Omit<NotificationSettings, 'email'> & { email?: boolean },
  ): Promise<NotificationSettings> {
    const changes = Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [`notificationSettings.${key}`, value]),
    );
    const user = await this.users
      .findByIdAndUpdate(userId, { $set: changes }, { returnDocument: 'after' })
      .select('notificationSettings')
      .exec();
    return settingsOf(user);
  }

  /** The token now pushes to [userId], whoever had it before. */
  async registerDevice(userId: string, token: string, platform: 'ios' | 'android' | 'web', lang: Lang) {
    await this.devices
      .updateOne(
        { token },
        { $set: { userId: new Types.ObjectId(userId), platform, lang } },
        { upsert: true },
      )
      .exec();
  }

  // ---- Push ----

  /**
   * Pushes [items], just put in their inboxes, to their users' phones without
   * holding up the caller. A failure is logged; the inbox already has them.
   */
  deliverLater(items: NotificationDocument[]): void {
    if (items.length === 0) return;
    const job = Promise.all([
      this.deliver(items).catch((error: unknown) => {
        logger.error('Push failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }),
      this.emailNow(items).catch((error: unknown) => {
        logger.error('Notification email failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    ])
      .then(() => {})
      .finally(() => this.sending.delete(job));
    this.sending.add(job);
  }

  // ---- Email ----

  /** Users that may get email, by id: a confirmed address, active, emails on. */
  private async emailable(userIds: Types.ObjectId[]) {
    const users = await this.users
      .find({
        _id: { $in: userIds },
        emailVerifiedAt: { $ne: null },
        accountStatus: AccountStatus.ACTIVE,
        'notificationSettings.email': { $ne: false },
      })
      .select('email')
      .lean()
      .exec();
    return new Map(users.map((user) => [user._id.toString(), user.email]));
  }

  /** Whether one more email fits under today's limit; counts it if so. */
  private takeEmail(now = new Date()): boolean {
    if (!this.email) return false;
    const day = cairoDay(now);
    if (this.emailed.day !== day) this.emailed = { day, count: 0 };
    if (this.emailed.count >= this.email.dailyLimit) {
      if (this.emailed.count === this.email.dailyLimit) {
        logger.warn('Daily email limit reached; the rest wait for tomorrow', { limit: this.email.dailyLimit });
      }
      this.emailed.count++;
      return false;
    }
    this.emailed.count++;
    return true;
  }

  /**
   * The notifications that can't wait (a shop's answer, a buyer's request, news
   * about a shop, listing or account), emailed now. Part requests at most once
   * every half hour per user: the others go in tomorrow's summary.
   */
  private async emailNow(items: NotificationDocument[]): Promise<void> {
    const channel = this.email;
    if (!channel) return;
    const urgent = items.filter((item) => EMAIL_NOW.has(item.kind));
    if (urgent.length === 0) return;
    const addresses = await this.emailable(urgent.map((item) => item.userId));
    for (const item of urgent) {
      const userId = item.userId.toString();
      const to = addresses.get(userId);
      if (!to) continue;
      if (item.kind === 'PART_REQUEST') {
        const recent = await this.notifications
          .exists({
            userId: item.userId,
            kind: 'PART_REQUEST',
            emailedAt: { $gte: new Date(Date.now() - REQUEST_EMAIL_GAP_MS) },
          })
          .exec();
        if (recent) continue;
      }
      if (!this.takeEmail()) return;
      const offUrl = emailOffUrl(channel.siteUrl, channel.apiPrefix, channel.secret, userId);
      await channel.mailer.send(notificationEmail('ar', to, emailItem(item), channel.siteUrl, offUrl));
      await this.notifications.updateOne({ _id: item._id }, { $set: { emailedAt: new Date() } }).exec();
    }
  }

  /**
   * Once a day, one email per user with what is new and still unread that
   * was not emailed on its own. Safe to run again: what went out is marked.
   */
  async sendDigest(now = new Date()): Promise<number> {
    const channel = this.email;
    if (!channel) return 0;
    const pending = await this.notifications
      .find({
        kind: { $in: EMAIL_DIGEST },
        read: false,
        emailedAt: null,
        createdAt: { $gte: new Date(now.getTime() - DIGEST_WINDOW_MS) },
      })
      .sort({ createdAt: -1 })
      .exec();
    const byUser = new Map<string, NotificationDocument[]>();
    for (const item of pending) {
      const key = item.userId.toString();
      byUser.set(key, [...(byUser.get(key) ?? []), item]);
    }
    const addresses = await this.emailable([...byUser.keys()].map((id) => new Types.ObjectId(id)));
    let sent = 0;
    for (const [userId, items] of byUser) {
      const to = addresses.get(userId);
      if (!to) continue;
      if (!this.takeEmail(now)) break;
      const offUrl = emailOffUrl(channel.siteUrl, channel.apiPrefix, channel.secret, userId);
      await channel.mailer.send(digestEmail('ar', to, items.map(emailItem), channel.siteUrl, offUrl));
      await this.notifications
        .updateMany({ _id: { $in: items.map((item) => item._id) } }, { $set: { emailedAt: now } })
        .exec();
      sent++;
    }
    return sent;
  }

  /** The daily summary, when its hour has come and it has not gone out today. */
  async digestIfDue(now = new Date()): Promise<void> {
    const day = cairoDay(now);
    if (cairoHour(now) < DIGEST_HOUR || this.lastDigestDay === day) return;
    this.lastDigestDay = day;
    const sent = await this.sendDigest(now);
    if (sent) logger.info('Daily notification emails sent', { users: sent });
  }

  /** A "stop these emails" link: emails off for that user. False if the link is not genuine. */
  async emailOff(userId: string, signature: string): Promise<boolean> {
    if (!this.email || !Types.ObjectId.isValid(userId) || !emailOffValid(this.email.secret, userId, signature)) {
      return false;
    }
    await this.users.updateOne({ _id: userId }, { $set: { 'notificationSettings.email': false } }).exec();
    return true;
  }

  /** Resolves once every push started so far has gone out. */
  async flush(): Promise<void> {
    await Promise.all([...this.sending]);
  }

  private async deliver(items: NotificationDocument[]): Promise<void> {
    const byUser = new Map(items.map((item) => [item.userId.toString(), item]));
    const devices = await this.devices
      .find({ userId: { $in: items.map((item) => item.userId) } })
      .select('token userId lang')
      .lean()
      .exec();
    const messages: PushMessage[] = [];
    for (const device of devices) {
      const item = byUser.get(device.userId.toString());
      if (!item) continue;
      const shown = present(item, device.lang === 'en' ? 'en' : 'ar');
      messages.push({
        token: device.token,
        title: shown.title,
        body: shown.body,
        data: {
          notificationId: shown.id,
          kind: shown.kind,
          ...(shown.partId ? { partId: shown.partId } : {}),
          ...(shown.shopId ? { shopId: shown.shopId } : {}),
          ...(shown.requestId ? { requestId: shown.requestId } : {}),
        },
      });
    }
    if (messages.length === 0) return;
    const { deadTokens } = await this.push.send(messages);
    if (deadTokens.length > 0) {
      await this.devices.deleteMany({ token: { $in: deadTokens } }).exec();
    }
  }

  async removeDevice(userId: string, token: string): Promise<void> {
    await this.devices.deleteOne({ token, userId: new Types.ObjectId(userId) }).exec();
  }

  // ---- What parts tell it ----

  /**
   * A new part: everyone with a car it fits hears of it, not its seller. A
   * part for every car (oils, tools) would reach everyone, so it notifies no one.
   */
  async partListed(part: PartDocument): Promise<void> {
    if (part.isSold || part.fitsAllCars || part.fitments.length === 0) return;
    const fits: QueryFilter<User> = {
      _id: { $ne: part.sellerId },
      'notificationSettings.fitsMyCar': { $ne: false },
      $or: part.fitments.map((fitment) => ({
        cars: {
          // Without a model, every owner of the make; a typed model, owners
          // who typed the same name.
          $elemMatch: fitment.modelId
            ? {
                brandId: fitment.brandId,
                modelId: fitment.modelId,
                year: { $gte: fitment.fromYear, $lte: fitment.toYear },
              }
            : fitment.modelKey
              ? {
                  ...brandMatch(fitment),
                  modelKey: fitment.modelKey,
                  ...(fitment.fromYear != null ? { year: { $gte: fitment.fromYear, $lte: fitment.toYear } } : {}),
                }
              : brandMatch(fitment),
        },
      })),
    };
    const users = await this.users.find(fits).select('_id').limit(MAX_RECIPIENTS).exec();
    await this.send(
      users.map((user) => user._id),
      'FITS_YOUR_CAR',
      [part.name, part.price == null ? '' : money(part.price), part.city],
      part._id,
    );
  }

  /** A part got cheaper: whoever saved it hears of it. */
  async priceDropped(part: PartDocument, from: number): Promise<void> {
    if (part.isSold || part.price == null || part.price >= from) return;
    const saved = await this.saved.find({ partId: part._id }).select('userId').exec();
    const users = await this.users
      .find({
        _id: { $in: saved.map((item) => item.userId), $ne: part.sellerId },
        'notificationSettings.priceDrops': { $ne: false },
      })
      .select('_id')
      .exec();
    await this.send(
      users.map((user) => user._id),
      'PRICE_DROP',
      [part.name, money(from), money(part.price)],
      part._id,
    );
  }

  /**
   * Tells a seller what 3arabity did to their listing. A removed part's
   * notice opens nothing, since the part is gone.
   */
  async listingNotice(
    sellerId: Types.ObjectId,
    change: ListingChange,
    part: { _id: Types.ObjectId; name: string },
  ): Promise<void> {
    await this.send(
      [sellerId],
      'LISTING',
      [change, part.name],
      change === 'REMOVED' ? null : part._id,
    );
  }

  /** Tells an owner what 3arabity decided about their shop, with the reason. */
  async shopNotice(
    ownerId: Types.ObjectId,
    change: ShopChange,
    shop: { _id: Types.ObjectId; name: string; statusReason?: string | null },
  ): Promise<void> {
    const items = await this.notifications.insertMany([
      {
        userId: ownerId,
        kind: 'SHOP',
        params: [change, shop.name, shop.statusReason ?? ''],
        shopId: shop._id,
      },
    ]);
    this.deliverLater(items);
  }

  /** Tells a user their account was verified or brought back. It opens their account. */
  async accountNotice(userId: Types.ObjectId, change: AccountChange): Promise<void> {
    await this.send([userId], 'ACCOUNT', [change], null);
  }

  /**
   * A new review for its seller, or the seller's answer for its author. It
   * opens the shop or part the review is about.
   */
  async reviewNotice(
    userId: Types.ObjectId,
    event: ReviewEvent,
    review: ReviewDocument,
    targetName: string,
  ): Promise<void> {
    const items = await this.notifications.insertMany([
      {
        userId,
        kind: 'REVIEW',
        params: [event, String(review.rating), targetName],
        partId: review.target === 'PART' ? review.targetId : null,
        shopId: review.target === 'SHOP' ? review.targetId : null,
      },
    ]);
    this.deliverLater(items);
  }

  /**
   * A part request: [NEW] tells the shops that could answer it ([params]: the
   * part); [REPLY] tells its buyer a shop answered (the shop, the price, the part).
   */
  async requestNotice(userIds: Types.ObjectId[], event: 'NEW' | 'REPLY', requestId: Types.ObjectId, params: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const items = await this.notifications.insertMany(
      userIds.map((userId) => ({ userId, kind: 'PART_REQUEST' as const, params: [event, ...params], requestId })),
    );
    this.deliverLater(items);
  }

  /** Deleted parts leave no notifications that open nothing. */
  async partsRemoved(partIds: Types.ObjectId[]): Promise<void> {
    if (partIds.length === 0) return;
    await this.notifications.deleteMany({ partId: { $in: partIds } }).exec();
  }

  /** A deleted shop leaves no notifications that open nothing. */
  async shopRemoved(shopId: Types.ObjectId): Promise<void> {
    await this.notifications.deleteMany({ shopId }).exec();
  }

  async deleteAllOf(userId: string): Promise<void> {
    const owner = new Types.ObjectId(userId);
    await Promise.all([
      this.notifications.deleteMany({ userId: owner }).exec(),
      this.devices.deleteMany({ userId: owner }).exec(),
    ]);
  }

  private async send(
    userIds: Types.ObjectId[],
    kind: NotificationKind,
    params: string[],
    partId: Types.ObjectId | null,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const items = await this.notifications.insertMany(
      userIds.map((userId) => ({ userId, kind, params, partId })),
    );
    this.deliverLater(items);
  }

  private mine(userId: string, id: string): QueryFilter<Notification> {
    if (!Types.ObjectId.isValid(id)) return { _id: { $exists: false } };
    return { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) };
  }
}

function settingsOf(
  user: { notificationSettings?: Partial<NotificationSettings> | null } | null,
): NotificationSettings {
  const settings = user?.notificationSettings;
  return {
    fitsMyCar: settings?.fitsMyCar ?? true,
    priceDrops: settings?.priceDrops ?? true,
    news: settings?.news ?? false,
    email: settings?.email ?? true,
  };
}

const cairo = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});
const cairoParts = (date: Date) =>
  Object.fromEntries(cairo.formatToParts(date).map((part) => [part.type, part.value]));
/** The date in Cairo, as 2026-11-17. */
const cairoDay = (date: Date) => {
  const parts = cairoParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const cairoHour = (date: Date) => Number(cairoParts(date).hour);

/** A notification as an email shows it: in Arabic, the site's language. */
function emailItem(item: NotificationDocument): EmailItem {
  const shown = present(item, 'ar');
  return {
    kind: shown.kind,
    title: shown.title,
    body: shown.body,
    partId: shown.partId,
    shopId: shown.shopId,
    requestId: shown.requestId,
  };
}

/** The notification as the app reads it, in [lang]. */
function present(item: NotificationDocument, lang: Lang) {
  const params = item.params;
  const [title, body] = (() => {
    switch (item.kind) {
      case 'FITS_YOUR_CAR':
        return [t(lang, 'notifications.fitsTitle'), t(lang, params[1] ? 'notifications.fitsBody' : 'notifications.fitsBodyNoPrice', params)];
      case 'PRICE_DROP':
        return [
          t(lang, 'notifications.priceDropTitle'),
          t(lang, 'notifications.priceDropBody', params),
        ];
      case 'LISTING': {
        const [change, name] = params;
        const key = change === 'HIDDEN' ? 'Hidden' : change === 'RESTORED' ? 'Restored' : 'Removed';
        return [
          t(lang, `notifications.listing${key}Title`),
          t(lang, `notifications.listing${key}Body`, [name]),
        ];
      }
      case 'REVIEW': {
        const [event, stars, name] = params;
        const key = event === 'REPLY' ? 'reviewReply' : 'newReview';
        return [
          t(lang, `notifications.${key}Title`, [stars]),
          t(lang, `notifications.${key}Body`, [stars, name]),
        ];
      }
      case 'SHOP': {
        const [change, name, reason] = params;
        const keys = {
          APPROVED: 'Approved',
          REJECTED: 'Rejected',
          SUSPENDED: 'Suspended',
          RESTORED: 'Restored',
          VERIFIED: 'Verified',
          FEATURED: 'Featured',
        } as const satisfies Record<ShopChange, string>;
        const key = keys[change as ShopChange] ?? 'Restored';
        return [
          t(lang, `notifications.shop${key}Title`),
          t(lang, `notifications.shop${key}Body`, [name, reason]),
        ];
      }
      case 'PART_REQUEST': {
        const [event, ...rest] = params;
        return event === 'REPLY'
          ? [t(lang, 'notifications.requestReplyTitle'), t(lang, rest[1] ? 'notifications.requestReplyBody' : 'notifications.requestReplyBodyNoPrice', rest)]
          : [t(lang, 'notifications.requestNewTitle'), t(lang, 'notifications.requestNewBody', rest)];
      }
      case 'ACCOUNT': {
        const key = params[0] === 'VERIFIED' ? 'Verified' : 'Restored';
        return [t(lang, `notifications.account${key}Title`), t(lang, `notifications.account${key}Body`)];
      }
      // News and announcements carry their own words: Arabic, then English.
      default:
        return lang === 'en' && params.length >= 4
          ? [params[2]!, params[3]!]
          : [params[0] ?? '', params[1] ?? ''];
    }
  })();
  return {
    id: item.id as string,
    kind: item.kind,
    title,
    body,
    partId: item.partId?.toString() ?? null,
    shopId: item.shopId?.toString() ?? null,
    requestId: item.requestId?.toString() ?? null,
    read: item.read,
    createdAt: item.createdAt,
  };
}
