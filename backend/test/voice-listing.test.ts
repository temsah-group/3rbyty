import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { auth, signUp } from './helpers/people.js';
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

const blank = { name: null, category: null, condition: null, isOriginal: null, partNumber: null, price: null, description: null, fitsAllCars: false, cars: [] };
const speak = (token: string | null, text: string, api = app.api) => {
  const req = api.post('/api/v1/listing-from-speech').send({ text });
  return token ? req.set(auth(token)) : req;
};

describe('a listing from what the seller said', () => {
  it('fills the form, matching cars to the list by their Arabic or English names', async () => {
    const seller = await signUp(app, 'seller@example.com');
    app.listingReader.result = {
      ...blank,
      name: 'مارش',
      category: 'ELECTRICAL',
      condition: 'USED',
      isOriginal: true,
      price: 1800,
      description: 'ضمان أسبوع',
      cars: [
        { make: 'Toyota', model: 'Corolla', fromYear: 2018, toYear: 2014 },
        { make: 'هيونداي', model: 'فيرنا', fromYear: 2012, toYear: null },
        { make: 'Kia', model: null, fromYear: null, toYear: null },
        { make: 'Zastava', model: 'Yugo', fromYear: 1995, toYear: 2005 },
        { make: 'Hyundai', model: 'Matrix X', fromYear: null, toYear: null },
      ],
    };
    const res = await speak(seller.token, 'مارش تويوتا كورولا من 2014 لـ 2018 مستعمل أصلي بألف وتمنمية').expect(200);
    expect(app.listingReader.heard).toEqual(['مارش تويوتا كورولا من 2014 لـ 2018 مستعمل أصلي بألف وتمنمية']);
    expect(res.body.data).toMatchObject({ name: 'مارش', category: 'ELECTRICAL', condition: 'USED', isOriginal: true, price: 1800, description: 'ضمان أسبوع', fitsAllCars: false });
    expect(res.body.data.fitments).toEqual([
      // Years said the wrong way round are put right.
      { brandId: 'toyota', brandName: null, modelId: 'corolla', modelName: null, fromYear: 2014, toYear: 2018 },
      // One year said: that year.
      { brandId: 'hyundai', brandName: null, modelId: 'verna', modelName: null, fromYear: 2012, toYear: 2012 },
      // A make alone.
      { brandId: 'kia', brandName: null, modelId: null, modelName: null, fromYear: null, toYear: null },
      // Not on the list: typed.
      { brandId: 'other', brandName: 'Zastava', modelId: null, modelName: 'Yugo', fromYear: 1995, toYear: 2005 },
      { brandId: 'hyundai', brandName: null, modelId: null, modelName: 'Matrix X', fromYear: null, toYear: null },
    ]);
  });

  it('drops what makes no sense: a silly price, impossible years, cars for an "every car" part', async () => {
    const seller = await signUp(app, 'seller@example.com');
    app.listingReader.result = { ...blank, name: 'زيت', price: 0, fitsAllCars: true, cars: [{ make: 'Toyota', model: null, fromYear: null, toYear: null }] };
    let res = await speak(seller.token, 'زيت يركب على كل العربيات').expect(200);
    expect(res.body.data).toMatchObject({ price: null, fitsAllCars: true, fitments: [] });

    app.listingReader.result = { ...blank, cars: [{ make: 'Toyota', model: 'Corolla', fromYear: 1800, toYear: 3000 }] };
    res = await speak(seller.token, 'كورولا').expect(200);
    expect(res.body.data.fitments).toEqual([{ brandId: 'toyota', brandName: null, modelId: 'corolla', modelName: null, fromYear: null, toYear: null }]);
  });

  it('is for signed-in sellers, says when it fails, and is off without a Claude key', async () => {
    expect((await speak(null, 'مارش')).status).toBe(401);
    const seller = await signUp(app, 'seller@example.com');
    expect((await speak(seller.token, '')).status).toBe(400);

    app.listingReader.fail = true;
    const failed = await speak(seller.token, 'مارش');
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('VOICE_LISTING_FAILED');

    const off = request(createApp({ ...app.container, listingReader: null }));
    const res = await speak(seller.token, 'مارش', off);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('VOICE_LISTING_OFF');
    expect((await off.get('/api/v1/app-config').expect(200)).body.data.features.voiceListing).toBe(false);
    expect((await app.api.get('/api/v1/app-config').expect(200)).body.data.features.voiceListing).toBe(true);
  });
});
