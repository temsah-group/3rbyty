import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { listPart, signUp } from './helpers/people.js';
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
});
