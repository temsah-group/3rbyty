// Puts the one Node app the host runs together: the API (backend/dist), the
// website in public/ and the dashboard in public/admin/, as in the earlier
// 3arabity-app.zip. Build the three first (npm run build in backend, front
// and admin), then:  node deploy/make-package.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'deploy', '3arabity-app');
const from = (...parts) => path.join(root, ...parts);

for (const dir of ['backend/dist', 'front/dist', 'admin/dist']) {
  if (!existsSync(from(dir, dir.startsWith('backend') ? 'server.js' : 'index.html'))) {
    throw new Error(`${dir} is not built: run npm run build in ${dir.split('/')[0]}`);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The API, without source maps.
cpSync(from('backend/dist'), path.join(out, 'dist'), { recursive: true, filter: (file) => !file.endsWith('.map') });

// The website, without the originals the light versions replaced
// (scripts/optimize-assets.mjs): brand logos as PNG and the sign-in photo as JPEG.
cpSync(from('front/dist'), path.join(out, 'public'), {
  recursive: true,
  filter: (file) => !/[\\/]brands[\\/][^\\/]+\.png$/.test(file) && !/[\\/]auth\.jpg$/.test(file),
});
cpSync(from('admin/dist'), path.join(out, 'public', 'admin'), { recursive: true });

// package.json for the host: what runs, and only what it needs installed.
const pkg = JSON.parse(readFileSync(from('backend/package.json'), 'utf8'));
const hostPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  description: pkg.description,
  type: 'module',
  engines: pkg.engines,
  scripts: { build: 'echo "Already built: dist/ is in the archive"', start: 'node server.js' },
  dependencies: pkg.dependencies,
  main: 'server.js',
};
writeFileSync(path.join(out, 'package.json'), `${JSON.stringify(hostPkg, null, 2)}\n`);
cpSync(from('backend/package-lock.json'), path.join(out, 'package-lock.json'));
if (existsSync(from('backend/.nvmrc'))) cpSync(from('backend/.nvmrc'), path.join(out, '.nvmrc'));
writeFileSync(
  path.join(out, 'server.js'),
  "// Entry point for the host: the API (and the website in public/) is built into dist/.\nimport './dist/server.js';\n",
);

console.log(`Ready: ${path.relative(root, out)}`);
