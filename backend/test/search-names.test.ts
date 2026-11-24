import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auth, listPart, signUp } from './helpers/people.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  await app.reset();
});

const search = async (q: string) =>
  ((await app.api.get('/api/v1/parts').query({ q }).expect(200)).body.data.items as { name: string }[]).map((p) => p.name).sort();

describe('searching by any name for a part', () => {
  it('finds a part under the other names people call it', async () => {
    const seller = await signUp(app, 'seller@example.com');
    await listPart(app, seller.token, { name: 'مارش', category: 'ELECTRICAL' });
    await listPart(app, seller.token, { name: 'فانوس أمامي يمين', category: 'LIGHTS' });
    await listPart(app, seller.token, { name: 'كمبروسر تكييف', category: 'ENGINE' });
    await listPart(app, seller.token, { name: 'مساعدين خلفي', category: 'SUSPENSION' });

    // Other names, English, misspellings, with "ال".
    expect(await search('سلف')).toEqual(['مارش']);
    expect(await search('starter')).toEqual(['مارش']);
    expect(await search('المارش')).toEqual(['مارش']);
    expect(await search('headlight')).toEqual(['فانوس أمامي يمين']);
    expect(await search('فوانيس قدامي')).toEqual(['فانوس أمامي يمين']);
    expect(await search('ac')).toEqual(['كمبروسر تكييف']);
    expect(await search('امتصاص ورا')).toEqual(['مساعدين خلفي']);
    // Every word still has to match: the other names widen a word, not the search.
    expect(await search('سلف كورولا')).toEqual(['مارش']);
    expect(await search('سلف هيونداي')).toEqual([]);
    // What was typed still matches as before.
    expect(await search('مار')).toEqual(['مارش']);
  });

  it('keeps short or shared words from matching what they shouldn\'t', async () => {
    const seller = await signUp(app, 'seller@example.com');
    await listPart(app, seller.token, { name: 'زيت موتور', category: 'FILTERS', city: 'كفر الشيخ' });
    await listPart(app, seller.token, { name: 'طقم تيل', category: 'BRAKES', fitments: [{ brandId: 'hyundai', modelId: 'accent', fromYear: 2010, toYear: 2015 }] });

    // "كاوتش" is not "كفر" (كفر الشيخ), and "تكييف" (ac) is not "Accent".
    expect(await search('كاوتش')).toEqual([]);
    expect(await search('تكييف')).toEqual([]);
    expect(await search('accent')).toEqual(['طقم تيل']);
  });

  it("doesn't bring a part for its category's or governorate's name, but finds oil by its grade and a whole category by its name", async () => {
    const seller = await signUp(app, 'seller@example.com');
    await listPart(app, seller.token, { name: 'Total 5000 4L', category: 'FILTERS', fitments: [], fitsAllCars: true });
    await listPart(app, seller.token, { name: 'فلتر زيت', category: 'FILTERS' });
    await listPart(app, seller.token, { name: 'مياه موبيل 4L', category: 'FILTERS', fitments: [], fitsAllCars: true });
    await listPart(app, seller.token, { name: 'تيل امامي', category: 'BRAKES' });
    await listPart(app, seller.token, { name: 'طقم جنط', category: 'TYRES' });
    await listPart(app, seller.token, { name: 'مارش', category: 'ELECTRICAL', city: 'الإسكندرية' });
    await listPart(app, seller.token, { name: 'فانوس شمال', category: 'LIGHTS', city: 'القاهرة' });
    await listPart(app, seller.token, { name: 'جلبة مقص', category: 'SUSPENSION', city: 'شمال سيناء' });

    // Oils are in "الفلاتر والزيوت": a filter search is filters, an oil search oils.
    expect(await search('فلتر')).toEqual(['فلتر زيت']);
    expect(await search('زيت')).toEqual(['Total 5000 4L', 'فلتر زيت']);
    expect(await search('زيت توتال')).toEqual(['Total 5000 4L']);
    // Tyres are not rims; a brand of parts is not a bush.
    expect(await search('كاوتش')).toEqual([]);
    expect(await search('بوش')).toEqual([]);
    // A whole category by name: brake pads for "فرامل".
    expect(await search('فرامل')).toEqual(['تيل امامي']);
    // "شمال" is the left side, not شمال سيناء; a governorate in a search is where.
    expect(await search('شمال')).toEqual(['فانوس شمال']);
    expect(await search('مارش اسكندريه')).toEqual(['مارش']);
    expect(await search('مارش القاهرة')).toEqual([]);
    expect(await search('الاسكندرية')).toEqual(['مارش']);
  });

  it('reads a year, condition or "original" in the search as filters, and takes a make or a model without a year', async () => {
    const seller = await signUp(app, 'seller@example.com');
    await listPart(app, seller.token, { name: 'مارش', category: 'ELECTRICAL', condition: 'USED' }); // Corolla 2014–2020
    await listPart(app, seller.token, { name: 'مارش', category: 'ELECTRICAL', condition: 'NEW', isOriginal: false, fitments: [{ brandId: 'hyundai', modelId: 'verna', fromYear: 2010, toYear: 2014 }] });
    await listPart(app, seller.token, { name: 'زيت', category: 'FILTERS', fitments: [], fitsAllCars: true });
    const cars = async (q: string, carsParam?: string) =>
      ((await app.api.get('/api/v1/parts').query({ q, ...(carsParam ? { cars: carsParam } : {}) }).expect(200)).body.data.items as { name: string; condition: string }[]).map((p) => `${p.name}:${p.condition}`).sort();

    // Words a part's text never has: a year, a condition.
    expect(await cars('مارش 2016')).toEqual(['مارش:NEW', 'مارش:USED']);
    expect(await cars('مارش مستعمل')).toEqual(['مارش:USED']);
    expect(await cars('مارش تجاري')).toEqual(['مارش:NEW']);
    // A make alone, a model in any year (with parts for every car), a model and year.
    expect(await cars('', 'toyota::')).toEqual(['زيت:NEW', 'مارش:USED']);
    expect(await cars('مارش', 'hyundai:verna:')).toEqual(['مارش:NEW']);
    expect(await cars('مارش', 'hyundai:verna:2018')).toEqual([]);
    expect((await app.api.get('/api/v1/parts').query({ cars: 'toyota:corolla:abc' })).status).toBe(400);
  });

  it("matches short words whole, leaves out the seller's name, and puts the best matches first", async () => {
    const seller = await signUp(app, 'mobil@example.com', 'سنتر موبيل');
    await listPart(app, seller.token, { name: 'شنطة سيراتو', category: 'BODY', fitments: [{ brandId: 'kia', modelId: 'cerato', fromYear: 2010, toYear: 2015 }] });
    await listPart(app, seller.token, { name: 'طقم سير كاتينة', category: 'ENGINE' });
    await listPart(app, seller.token, { name: 'Shell ultra 4L', category: 'FILTERS', fitments: [], fitsAllCars: true });
    await listPart(app, seller.token, { name: 'موبيل 1 5w40', category: 'FILTERS', fitments: [], fitsAllCars: true });
    // Newest last, so only "best match" can put it first.
    await listPart(app, seller.token, { name: 'مساعد كيا', category: 'SUSPENSION', fitments: [{ brandId: 'kia', modelId: 'cerato', fromYear: 2010, toYear: 2015 }] });

    // "سير" is a belt, not the start of "سيراتو".
    expect(await search('سير')).toEqual(['طقم سير كاتينة']);
    // The seller is "سنتر موبيل": only the Mobil oil comes up for "موبيل".
    expect(await search('موبيل')).toEqual(['موبيل 1 5w40']);
    // Oil brands in Arabic find them written in English.
    expect(await search('شل')).toEqual(['Shell ultra 4L']);
    // Digits still match inside a word.
    expect(await search('5w40')).toEqual(['موبيل 1 5w40']);

    // Best match: the part named "سيراتو" before the one that is only for a Cerato, though newer.
    const best = (await app.api.get('/api/v1/parts').query({ q: 'سيراتو', sort: 'RELEVANCE' }).expect(200)).body.data.items as { name: string }[];
    expect(best.map((p) => p.name)).toEqual(['شنطة سيراتو', 'مساعد كيا']);
    const newest = (await app.api.get('/api/v1/parts').query({ q: 'سيراتو', sort: 'NEWEST' }).expect(200)).body.data.items as { name: string }[];
    expect(newest.map((p) => p.name)).toEqual(['مساعد كيا', 'شنطة سيراتو']);
    // Paged: one at a time, in that order.
    const first = (await app.api.get('/api/v1/parts').query({ q: 'سيراتو', sort: 'RELEVANCE', limit: 1 }).expect(200)).body.data;
    const second = (await app.api.get('/api/v1/parts').query({ q: 'سيراتو', sort: 'RELEVANCE', limit: 1, cursor: first.nextCursor }).expect(200)).body.data;
    expect([first.items[0].name, second.items[0].name]).toEqual(['شنطة سيراتو', 'مساعد كيا']);
    expect(second.nextCursor).toBeNull();
  });

  it('lists a part without a price, leaves it out of price sorts, and lets the seller price it later', async () => {
    const seller = await signUp(app, 'seller@example.com');
    const free = await listPart(app, seller.token, { name: 'مارش', category: 'ELECTRICAL', price: null });
    await listPart(app, seller.token, { name: 'مارش', category: 'ELECTRICAL', condition: 'USED', price: 900 });
    expect(free.price).toBeNull();

    const prices = async (query: Record<string, string>) =>
      ((await app.api.get('/api/v1/parts').query({ q: 'مارش', ...query }).expect(200)).body.data.items as { price: number | null }[]).map((p) => p.price);
    expect((await prices({})).sort()).toEqual([900, null]);
    expect(await prices({ sort: 'PRICE_LOW' })).toEqual([900]);
    expect(await prices({ maxPrice: '5000' })).toEqual([900]);

    const priced = await app.api.patch(`/api/v1/parts/${free.id}`).set(auth(seller.token)).send({ price: 1200 }).expect(200);
    expect(priced.body.data.price).toBe(1200);
    const cleared = await app.api.patch(`/api/v1/parts/${free.id}`).set(auth(seller.token)).send({ price: null }).expect(200);
    expect(cleared.body.data.price).toBeNull();
    // A discount needs a price.
    expect((await app.api.patch(`/api/v1/parts/${free.id}`).set(auth(seller.token)).send({ oldPrice: 1500 })).status).toBe(400);
  });

  it('with a car chosen, puts the parts listed for it before the ones for every car', async () => {
    const seller = await signUp(app, 'seller@example.com');
    await listPart(app, seller.token, { name: 'تيل سكودا', category: 'BRAKES', fitments: [{ brandId: 'skoda', modelId: 'superb', fromYear: 2018, toYear: 2024 }] });
    await listPart(app, seller.token, { name: 'مارش النترا', category: 'ELECTRICAL', fitments: [{ brandId: 'hyundai', modelId: 'elantra', fromYear: 2012, toYear: 2016 }] });
    // Newer, and for every car: still after the Skoda's own part.
    await listPart(app, seller.token, { name: 'زيت 5w30', category: 'FILTERS', fitments: [], fitsAllCars: true });
    await listPart(app, seller.token, { name: 'زيت 10w40', category: 'FILTERS', fitments: [], fitsAllCars: true });

    const names = async (query: Record<string, string>) =>
      ((await app.api.get('/api/v1/parts').query(query).expect(200)).body.data.items as { name: string }[]).map((p) => p.name);
    expect(await names({ cars: 'skoda:superb:2021' })).toEqual(['تيل سكودا', 'زيت 10w40', 'زيت 5w30']);
    expect(await names({ cars: 'skoda:superb:2021', sort: 'RELEVANCE' })).toEqual(['تيل سكودا', 'زيت 10w40', 'زيت 5w30']);
    // Never another car's part.
    expect(await names({ cars: 'skoda:superb:2021' })).not.toContain('مارش النترا');
    // Without a car: simply newest.
    expect((await names({}))[0]).toBe('زيت 10w40');
    // Prices still sort by price.
    expect(await names({ cars: 'skoda:superb:2021', sort: 'PRICE_LOW' })).toHaveLength(3);

    const home = (await app.api.get('/api/v1/parts/home').query({ cars: 'skoda:superb:2021' }).expect(200)).body.data as { latest: { name: string }[] };
    expect(home.latest.map((p) => p.name)).toEqual(['تيل سكودا', 'زيت 10w40', 'زيت 5w30']);
  });
});
