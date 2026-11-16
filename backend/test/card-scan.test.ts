import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

// The smallest valid PNG header is enough: the server only sniffs the type.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

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

const scan = (file: Buffer, api = app.api) =>
  api.post('/api/v1/auth/scan-card').set('Accept-Language', 'ar').attach('photo', file, 'card.png');

describe('business card scan', () => {
  it('returns what the card says, for the sign-up form', async () => {
    app.cardScanner.result = { shopName: 'الأمانة لقطع الغيار', phone: '010 1234 5678', city: 'الإسماعيلية', address: 'شارع الثلاثيني' };
    const res = await scan(PNG).expect(200);
    expect(res.body.data).toEqual(app.cardScanner.result);
    expect(app.cardScanner.scanned).toEqual(['image/png']);
  });

  it('turns away a file that is not a photo', async () => {
    const res = await scan(Buffer.from('not an image at all'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PHOTO_INVALID');
    expect(app.cardScanner.scanned).toHaveLength(0);
  });

  it('says so when the card could not be read', async () => {
    app.cardScanner.fail = true;
    const res = await scan(PNG);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('CARD_SCAN_FAILED');
  });

  it('is off without a Claude key, and the app config says so', async () => {
    const off = request(createApp({ ...app.container, cardScanner: null }));
    const res = await scan(PNG, off);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('CARD_SCAN_OFF');

    const config = await off.get('/api/v1/app-config').expect(200);
    expect(config.body.data.features).toMatchObject({ cardScan: false });
    const on = await app.api.get('/api/v1/app-config').expect(200);
    expect(on.body.data.features).toMatchObject({ cardScan: true });
  });
});
