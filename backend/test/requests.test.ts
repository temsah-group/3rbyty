import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

/** An approved shop for a new owner; [extra] changes its details. */
async function openShop(email: string, extra: object = {}) {
  const owner = await signUp(app, email, 'صاحب محل');
  const created = await app.api.post('/api/v1/shops').set(auth(owner.token)).send(shopInput(extra)).expect(201);
  admin ??= await adminToken(app);
  await app.api.patch(`/api/v1/admin/shops/${created.body.data.id}`).set(auth(admin)).send({ status: 'APPROVED' }).expect(200);
  return { ...owner, shopId: created.body.data.id as string };
}

const ask = (token: string, extra: object = {}) =>
  app.api
    .post('/api/v1/requests')
    .set(auth(token))
    .send({ partName: 'طقم تيل فرامل أمامي', category: 'BRAKES', car: { brandId: 'toyota', modelId: 'corolla', year: 2016 }, city: 'الجيزة', ...extra });

async function inboxOf(token: string) {
  return (await app.api.get('/api/v1/requests/inbox').set(auth(token)).expect(200)).body.data.items as { id: string; myReply: unknown }[];
}

async function notificationsOf(token: string) {
  await app.container.notifications.flush();
  return (await app.api.get('/api/v1/notifications').set(auth(token)).expect(200)).body.data.items as { title: string; body: string; requestId: string | null }[];
}

describe('asking shops for a part', () => {
  it('tells the shops that carry the make there, takes their answers, and shows them to the buyer', async () => {
    // Toyota, delivers to Giza: told. Hyundai only: not. Toyota in Alexandria, no delivery: not.
    const fits = await openShop('fits@example.com');
    const otherMake = await openShop('hyundai@example.com', { brandIds: ['hyundai'] });
    const elsewhere = await openShop('alex@example.com', { city: 'الإسكندرية', delivery: { available: false, governorates: [] } });
    const buyer = await signUp(app, 'buyer@example.com', 'مشتري');

    const created = await ask(buyer.token).expect(201);
    const id = created.body.data.id as string;
    expect(created.body.data).toMatchObject({ open: true, replyCount: 0, city: 'الجيزة' });

    expect((await notificationsOf(fits.token)).some((n) => n.requestId === id)).toBe(true);
    expect((await notificationsOf(otherMake.token)).some((n) => n.requestId === id)).toBe(false);
    expect((await notificationsOf(elsewhere.token)).some((n) => n.requestId === id)).toBe(false);
    expect((await inboxOf(fits.token)).map((r) => r.id)).toEqual([id]);
    expect(await inboxOf(otherMake.token)).toEqual([]);

    // The shop answers, then changes its answer: the buyer hears once.
    await app.api.post(`/api/v1/requests/${id}/replies`).set(auth(fits.token)).send({ price: 850, condition: 'NEW', isOriginal: true }).expect(200);
    await app.api.post(`/api/v1/requests/${id}/replies`).set(auth(fits.token)).send({ price: 800, condition: 'NEW', isOriginal: true, note: 'متوفر' }).expect(200);
    const told = (await notificationsOf(buyer.token)).filter((n) => n.requestId === id);
    expect(told).toHaveLength(1);
    expect(told[0]!.body).toContain('850');

    const seen = (await app.api.get(`/api/v1/requests/${id}`).set(auth(buyer.token)).expect(200)).body.data;
    expect(seen.replyCount).toBe(1);
    expect(seen.replies).toHaveLength(1);
    expect(seen.replies[0]).toMatchObject({ price: 800, note: 'متوفر', shop: { id: fits.shopId, phone: '+201001234567' } });

    // A shop it was not meant for can neither see nor answer it.
    await app.api.get(`/api/v1/requests/${id}`).set(auth(otherMake.token)).expect(404);
    await app.api.post(`/api/v1/requests/${id}/replies`).set(auth(otherMake.token)).send({ price: 500, condition: 'USED' }).expect(404);

    // Closed by the buyer: no more answers, gone from the inbox.
    await app.api.post(`/api/v1/requests/${id}/close`).set(auth(buyer.token)).expect(200);
    expect(await inboxOf(fits.token)).toEqual([]);
    const late = await app.api.post(`/api/v1/requests/${id}/replies`).set(auth(fits.token)).send({ price: 700, condition: 'NEW' });
    expect(late.status).toBe(400);
    expect(late.body.code).toBe('REQUEST_CLOSED');
  });

  it('tells shops in every governorate when the buyer names none', async () => {
    const giza = await openShop('giza@example.com');
    const alex = await openShop('alex@example.com', { city: 'الإسكندرية', delivery: { available: false, governorates: [] } });
    const otherMake = await openShop('hyundai@example.com', { city: 'الإسكندرية', brandIds: ['hyundai'] });
    const buyer = await signUp(app, 'buyer@example.com', 'مشتري');

    const created = await ask(buyer.token, { city: null }).expect(201);
    const id = created.body.data.id as string;
    expect(created.body.data.city).toBeNull();
    expect((await ask(buyer.token, { city: undefined }).expect(201)).body.data.city).toBeNull();

    // Any place, still only the shops for the make.
    expect((await notificationsOf(giza.token)).some((n) => n.requestId === id)).toBe(true);
    expect((await notificationsOf(alex.token)).some((n) => n.requestId === id)).toBe(true);
    expect((await notificationsOf(otherMake.token)).some((n) => n.requestId === id)).toBe(false);
    expect((await inboxOf(alex.token)).map((r) => r.id)).toContain(id);
    await app.api.post(`/api/v1/requests/${id}/replies`).set(auth(alex.token)).send({ price: 900, condition: 'USED' }).expect(200);
  });

  it('takes a car typed by hand, and checks what it is given', async () => {
    const shop = await openShop('any@example.com', { brandIds: [] });
    const buyer = await signUp(app, 'buyer@example.com');
    const typed = await ask(buyer.token, { car: { brandId: 'other', brandName: 'بروتون', modelName: 'ساجا' }, category: null }).expect(201);
    // A shop that carries every make hears of a typed one.
    expect((await inboxOf(shop.token)).map((r) => r.id)).toEqual([typed.body.data.id]);

    expect((await ask(buyer.token, { partName: 'x' })).status).toBe(400);
    expect((await ask(buyer.token, { city: 'Atlantis' })).status).toBe(400);
    expect((await ask(buyer.token, { car: { brandId: 'toyota', modelId: 'corolla', year: 1900 } })).status).toBe(400);
  });

  it('keeps a buyer to five open requests, and the inbox to shops', async () => {
    const buyer = await signUp(app, 'buyer@example.com');
    for (let i = 0; i < 5; i++) await ask(buyer.token).expect(201);
    const sixth = await ask(buyer.token);
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('TOO_MANY_REQUESTS');
    const inbox = await app.api.get('/api/v1/requests/inbox').set(auth(buyer.token));
    expect(inbox.status).toBe(403);
    expect(inbox.body.code).toBe('SHOP_REQUIRED');
    expect((await app.api.get('/api/v1/requests/mine').set(auth(buyer.token)).expect(200)).body.data.items).toHaveLength(5);
  });
});
