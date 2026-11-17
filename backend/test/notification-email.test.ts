import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Mail } from '../src/modules/mail/mailer.js';
import { adminToken, auth, shopInput, signUp } from './helpers/people.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(async () => {
  await app?.close();
});
let admin: string | null = null;
beforeEach(async () => {
  await app.reset();
  admin = null;
});

/** Notification emails only (not sign-up codes). */
const emailsTo = (to: string): Mail[] => app.mailer.sent.filter((mail) => mail.to === to && mail.headers?.['List-Unsubscribe']);

async function settle() {
  await app.container.notifications.flush();
}

async function openShop(email: string) {
  const owner = await signUp(app, email, 'صاحب محل');
  const created = await app.api.post('/api/v1/shops').set(auth(owner.token)).send(shopInput()).expect(201);
  admin ??= await adminToken(app);
  await app.api.patch(`/api/v1/admin/shops/${created.body.data.id}`).set(auth(admin)).send({ status: 'APPROVED' }).expect(200);
  await settle();
  return owner;
}

const ask = (token: string) =>
  app.api
    .post('/api/v1/requests')
    .set(auth(token))
    .send({ partName: 'طقم تيل فرامل أمامي', car: { brandId: 'toyota', modelId: 'corolla', year: 2016 }, city: 'الجيزة' })
    .expect(201);

const reply = (token: string, id: string, price: number) =>
  app.api.post(`/api/v1/requests/${id}/replies`).set(auth(token)).send({ price, condition: 'NEW', isOriginal: true });

/** The stop link in an email, as the API path and query. */
const offLinkOf = (mail: Mail) => {
  const url = new URL(mail.headers!['List-Unsubscribe']!.slice(1, -1));
  return `${url.pathname}${url.search}`;
};

describe('notifications by email', () => {
  it('emails the important ones as they happen, with a link to open and one to stop', async () => {
    const shop = await openShop('shop@example.com');
    // The shop was approved: that news is emailed.
    expect(emailsTo('shop@example.com').map((mail) => mail.subject)).toHaveLength(1);

    const buyer = await signUp(app, 'buyer@example.com', 'مشتري');
    const request = await ask(buyer.token);
    const id = request.body.data.id as string;
    await settle();
    // The shop hears of the buyer's request.
    const forShop = emailsTo('shop@example.com');
    expect(forShop).toHaveLength(2);
    expect(forShop[1]!.text).toContain(`/requests/${id}`);

    await reply(shop.token, id, 900).expect(200);
    await settle();
    const [answer] = emailsTo('buyer@example.com');
    expect(answer!.subject).toBeTruthy();
    expect(answer!.text).toContain('900');
    expect(answer!.text).toContain(`/requests/${id}`);
    expect(answer!.html).toContain(`/requests/${id}`);
    expect(answer!.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('emails part requests at most every half hour; the rest wait for the daily summary', async () => {
    const shop = await openShop('shop@example.com');
    const other = await openShop('other@example.com');
    const buyer = await signUp(app, 'buyer@example.com', 'مشتري');
    const id = (await ask(buyer.token)).body.data.id as string;
    await settle();
    await reply(shop.token, id, 900).expect(200);
    await settle();
    await reply(other.token, id, 800).expect(200);
    await settle();
    expect(emailsTo('buyer@example.com')).toHaveLength(1);

    const sent = await app.container.notifications.sendDigest(new Date());
    expect(sent).toBeGreaterThanOrEqual(1);
    const mails = emailsTo('buyer@example.com');
    expect(mails).toHaveLength(2);
    expect(mails[1]!.text).toContain('800');
    // Already emailed: not again.
    await app.container.notifications.sendDigest(new Date());
    expect(emailsTo('buyer@example.com')).toHaveLength(2);
  });

  it('puts the rest in one daily email, without what was read or what is old', async () => {
    const user = await signUp(app, 'user@example.com');
    const { Notification } = app.container.models;
    const userId = new Types.ObjectId(user.id);
    const now = new Date();
    await Notification.insertMany([
      { userId, kind: 'FITS_YOUR_CAR', params: ['فانوس أمامي', '1,500', 'القاهرة'] },
      { userId, kind: 'PRICE_DROP', params: ['طقم تيل', '900', '750'] },
      { userId, kind: 'PRICE_DROP', params: ['مقروءة', '900', '750'], read: true },
    ]);
    await Notification.collection.insertOne({
      userId, kind: 'FITS_YOUR_CAR', params: ['قديمة', '1', 'القاهرة'], read: false, emailedAt: null,
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60_000), updatedAt: now,
    });

    expect(await app.container.notifications.sendDigest(now)).toBe(1);
    const [digest] = emailsTo('user@example.com');
    expect(digest!.text).toContain('فانوس أمامي');
    expect(digest!.text).toContain('طقم تيل');
    expect(digest!.text).not.toContain('مقروءة');
    expect(digest!.text).not.toContain('قديمة');
  });

  it('sends nothing to someone who turned emails off, or whose address is not confirmed', async () => {
    const quiet = await signUp(app, 'quiet@example.com');
    await app.api
      .put('/api/v1/notifications/settings')
      .set(auth(quiet.token))
      .send({ fitsMyCar: true, priceDrops: true, news: false, email: false })
      .expect(200);
    const unconfirmed = await signUp(app, 'unconfirmed@example.com');
    await app.container.models.User.updateOne({ _id: unconfirmed.id }, { $set: { emailVerifiedAt: null } });

    const { Notification } = app.container.models;
    for (const user of [quiet, unconfirmed]) {
      await Notification.create({ userId: new Types.ObjectId(user.id), kind: 'PRICE_DROP', params: ['طقم تيل', '900', '750'] });
      await app.container.notifications.accountNotice(new Types.ObjectId(user.id), 'VERIFIED');
    }
    await settle();
    await app.container.notifications.sendDigest(new Date());
    expect(emailsTo('quiet@example.com')).toEqual([]);
    expect(emailsTo('unconfirmed@example.com')).toEqual([]);
  });

  it('turns emails off from the link in an email, and only with a genuine link', async () => {
    const user = await signUp(app, 'user@example.com');
    await app.container.notifications.accountNotice(new Types.ObjectId(user.id), 'VERIFIED');
    await settle();
    const link = offLinkOf(emailsTo('user@example.com')[0]!);

    // Someone else's id with this signature: refused.
    const other = await signUp(app, 'other@example.com');
    const forged = link.replace(user.id, other.id);
    expect((await app.api.get(forged)).status).toBe(400);

    const page = await app.api.get(link).expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    const settings = await app.api.get('/api/v1/notifications/settings').set(auth(user.token)).expect(200);
    expect(settings.body.data.email).toBe(false);
    const otherSettings = await app.api.get('/api/v1/notifications/settings').set(auth(other.token)).expect(200);
    expect(otherSettings.body.data.email).toBe(true);

    // Mail apps' one-click POST works the same.
    await app.api.put('/api/v1/notifications/settings').set(auth(user.token)).send({ fitsMyCar: true, priceDrops: true, news: false, email: true }).expect(200);
    await app.api.post(link).expect(200);
    expect((await app.api.get('/api/v1/notifications/settings').set(auth(user.token))).body.data.email).toBe(false);
  });
});
