import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { adminToken, auth, listPart, shopInput, signUp } from './helpers/people.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

let app: TestApp;
let site: ReturnType<typeof request>;

beforeAll(async () => {
  app = await startTestApp();
  // The site's real index.html, as a build leaves it.
  const dir = await mkdtemp(path.join(tmpdir(), 'arabity-web-'));
  const html = (await readFile(path.resolve(__dirname, '../../front/index.html'), 'utf8')).replaceAll('%VITE_SITE_URL%', 'https://3rbyty.example');
  await writeFile(path.join(dir, 'index.html'), html);
  site = request(createApp({ ...app.container, env: { ...app.container.env, WEB_DIR: dir } }));
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  await app.reset();
});

const head = (html: string) => html.slice(0, html.indexOf('</head>'));
const jsonLd = (html: string) => {
  const match = html.match(/<script type="application\/ld\+json" data-ssr>(.*?)<\/script>/);
  return match ? JSON.parse(match[1]!) : null;
};

describe('pages sent with their own details', () => {
  it('a part: its name, cars, price and photo in the title, preview and structured data', async () => {
    const seller = await signUp(app, 'seller@example.com');
    const { id } = await listPart(app, seller.token, { name: 'مارش', category: 'ELECTRICAL', price: 1800, condition: 'USED', isOriginal: true, description: 'ضمان أسبوع' });

    const res = await site.get(`/parts/${id}`).expect(200);
    const html = head(res.text);
    expect(html).toContain('<title>مارش تويوتا كورولا');
    expect(html).toMatch(/<meta name="description" content="مستعمل أصلي · 1,800 جنيه · [^"]*لـ تويوتا كورولا[^"]*ضمان أسبوع"/);
    expect(html).toContain(`<link rel="canonical" href="https://3rbyty.example/parts/${id}"`);
    expect(html).toContain(`<meta property="og:url" content="https://3rbyty.example/parts/${id}"`);
    expect(html).not.toContain('og:image:width');
    expect(jsonLd(res.text)).toMatchObject({
      '@type': 'Product',
      name: 'مارش',
      offers: { price: 1800, priceCurrency: 'EGP', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/UsedCondition' },
    });
    // Seeing the page this way doesn't count as a view.
    expect((await app.container.models.Part.findById(id).lean())!.stats!.views).toBe(0);
  });

  it('a removed or hidden part, or a made-up address: a 404 kept out of search results', async () => {
    const missing = await site.get('/parts/6a0000000000000000000000').expect(404);
    expect(head(missing.text)).toContain('<meta name="robots" content="noindex, follow" />');
    expect(head(missing.text)).toContain('القطعة دي مش موجودة');
    expect((await site.get('/parts/not-an-id')).status).toBe(404);
    // The app itself still loads, to show its own "not found" page.
    expect(missing.text).toContain('<div id="root"></div>');
  });

  it('a shop: name, governorate and a local business for maps', async () => {
    const owner = await signUp(app, 'shop@example.com', 'صاحب محل');
    const created = await app.api.post('/api/v1/shops').set(auth(owner.token)).send(shopInput()).expect(201);
    const id = created.body.data.id as string;
    // Not approved yet: not a page.
    expect((await site.get(`/shops/${id}`)).status).toBe(404);
    const admin = await adminToken(app);
    await app.api.patch(`/api/v1/admin/shops/${id}`).set(auth(admin)).send({ status: 'APPROVED' }).expect(200);

    const res = await site.get(`/shops/${id}`).expect(200);
    expect(head(res.text)).toContain('<title>محل النور لقطع الغيار — قطع غيار في القاهرة | عربيتي</title>');
    expect(jsonLd(res.text)).toMatchObject({ '@type': 'AutoPartsStore', name: 'محل النور لقطع الغيار', address: { addressRegion: 'القاهرة', addressCountry: 'EG' } });
  });

  it('fixed pages get their titles; the home page and private pages stay as built', async () => {
    expect(head((await site.get('/shops').expect(200)).text)).toContain('<title>محلات قطع الغيار | عربيتي</title>');
    expect(head((await site.get('/search').expect(200)).text)).toContain('<title>كل قطع الغيار | عربيتي</title>');
    const home = (await site.get('/').expect(200)).text;
    expect(head(home)).toContain('<title>عربيتي 3rbyty — قطع غيار العربيات في مصر</title>');
    // Who the site is: its names, logo and pages elsewhere.
    const organization = jsonLd(home)['@graph'].find((item: { '@type': string }) => item['@type'] === 'Organization');
    expect(organization).toMatchObject({ name: 'عربيتي', alternateName: expect.arrayContaining(['3rbyty']) });
    expect(organization.sameAs).toEqual(expect.arrayContaining(['https://www.instagram.com/3rbyty_/', 'https://www.tiktok.com/@3rbyty']));
    expect(head((await site.get('/account').expect(200)).text)).toContain('<title>عربيتي 3rbyty — قطع غيار العربيات في مصر</title>');
  });
});
