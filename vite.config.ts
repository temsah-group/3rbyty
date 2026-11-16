import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';

/**
 * robots.txt, written from .env: private pages stay out of search engines,
 * and the sitemap is the API's (it lists every part and shop).
 */
function robots(env: Record<string, string>): Plugin {
  const api = env.VITE_API_URL?.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  const sitemap = `${api || env.VITE_SITE_URL?.replace(/\/+$/, '') || ''}/sitemap.xml`;
  const text = [
    'User-agent: *',
    ...['/account', '/notifications', '/sell', '/saved', '/login', '/register', '/verify', '/forgot-password', '/reset-password'].map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${sitemap}`,
    '',
  ].join('\n');
  return {
    name: 'robots',
    configureServer(server) {
      server.middlewares.use('/robots.txt', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(text);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: text });
    },
  };
}

/**
 * The free business-card reader (Tesseract) and its Arabic and English data,
 * served from the site itself under /ocr/ rather than from a CDN: in
 * development straight from node_modules, in a build as files in dist/ocr/.
 * Only loaded when someone taps "snap your business card".
 */
function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const files: Record<string, string> = {
    'ocr/worker.min.js': require.resolve('tesseract.js/dist/worker.min.js'),
    // Tesseract picks one by what the browser supports; LSTM-only builds.
    ...Object.fromEntries(
      ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((name) => [
        `ocr/core/${name}`,
        require.resolve(`tesseract.js-core/${name}`),
      ]),
    ),
    // The accurate ("best") models, not the default fast ones.
    'ocr/lang/ara.traineddata.gz': require.resolve('@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz'),
    'ocr/lang/eng.traineddata.gz': require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
  };
  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files[(req.url ?? '').split('?')[0].replace(/^\//, '')];
        if (!file) return next();
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
      }
    },
  };
}

// In development the API is proxied, so the browser sees one origin:
// no CORS setup on the backend and photos load as they are.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.API_PROXY_TARGET || 'http://localhost:3000';
  return {
    plugins: [react(), robots(env), ocrAssets()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: {
      target: 'es2020',
      rollupOptions: {
        output: {
          // The libraries change far less often than the site's own code: in
          // their own files, a returning visitor keeps them cached after an upload.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
          },
        },
      },
    },
    server: {
      // 5173 is the admin dashboard's port.
      port: 5174,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/uploads': { target, changeOrigin: true },
        '/sitemap.xml': { target, changeOrigin: true },
        // The admin dashboard (`npm run dev` in admin), so it opens at /admin here too.
        '/admin': { target: env.ADMIN_DEV_URL || 'http://localhost:5173', ws: true },
      },
    },
  };
});
