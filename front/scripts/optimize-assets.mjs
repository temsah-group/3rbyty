// Makes the light versions of the site's own pictures, next to the originals
// in public/: WebP for photos and logos, small PNGs for the icon. Run after
// changing a source picture:  node scripts/optimize-assets.mjs
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const kb = async (file) => `${Math.round((await stat(file)).size / 1024)}KB`;
const made = [];

async function webp(from, to, { width, quality = 72 } = {}) {
  await sharp(from).resize(width ? { width, withoutEnlargement: true } : undefined).webp({ quality, effort: 6 }).toFile(to);
  made.push(`${path.relative(pub, to)} ${await kb(to)}`);
}

// The wide hero photo (desktop and tablets); phones get a drawn background instead.
for (const width of [800, 1200, 1600, 2400]) {
  await webp(path.join(pub, `hero/engine-${width}.jpg`), path.join(pub, `hero/engine-${width}.webp`), { quality: 62 });
}

// The sign-in panel's photo.
await webp(path.join(pub, 'auth.jpg'), path.join(pub, 'auth.webp'), { width: 1200, quality: 65 });

// The logo: the header shows it at 36px, the sign-in page at 56px.
const icon = path.join(pub, 'icon.png');
for (const [name, size] of [['icon-72.png', 72], ['icon-112.png', 112], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
  const to = path.join(pub, name);
  await sharp(icon).resize(size, size).png({ compressionLevel: 9, palette: true }).toFile(to);
  made.push(`${name} ${await kb(to)}`);
}
await sharp(icon).resize(72, 72).webp({ quality: 85 }).toFile(path.join(pub, 'icon-72.webp'));
await sharp(icon).resize(112, 112).webp({ quality: 85 }).toFile(path.join(pub, 'icon-112.webp'));

// Car makes' logos, shown at up to 48px: 96px covers sharp screens.
for (const file of await readdir(path.join(pub, 'brands'))) {
  if (!file.endsWith('.png')) continue;
  const from = path.join(pub, 'brands', file);
  await sharp(from).resize(96, 96, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, alphaQuality: 90 }).toFile(from.replace(/\.png$/, '.webp'));
}
made.push('brands/*.webp');

console.log(made.join('\n'));
