import { existsSync } from 'node:fs';
import path from 'node:path';

import express, { Router } from 'express';
import helmet from 'helmet';

/** What the API answers; everything else is the website. */
const API_PATHS = /^\/(?:api|uploads)(?:\/|$)|^\/sitemap\.xml$/;

/**
 * The website and the dashboard from [dir] (the web build, with the
 * dashboard's build in `admin/`), so one Node app serves the whole domain.
 * Null when [dir] has no build, e.g. in development.
 */
export function websiteRoutes(dir: string): Router | null {
  const root = path.resolve(dir);
  const site = path.join(root, 'index.html');
  if (!existsSync(site)) return null;
  const admin = path.join(root, 'admin', 'index.html');

  const router = Router();
  router.use((req, _res, next) => (API_PATHS.test(req.path) ? next('router') : next()));
  // /ADMIN, /Admin…: the dashboard lives at /admin, and paths are case-sensitive.
  router.use((req, res, next) => {
    const match = req.path.match(/^\/admin(?=\/|$)/i);
    if (!match || match[0] === '/admin') return next();
    res.redirect(301, '/admin' + req.originalUrl.slice(match[0].length));
  });
  // Pages, not JSON: Google sign-in needs its popup and the page's origin,
  // and the pages load photos and scripts from other hosts.
  router.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  router.use(
    express.static(root, {
      index: false,
      setHeaders: (res, file) => {
        if (/(?:index\.html|push-sw\.js)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
        else if (file.includes(`${path.sep}assets${path.sep}`)) {
          // Hashed build files never change.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (/\.(?:woff2?|ttf|jpe?g|png|webp|svg|ico|gz|wasm)$/.test(file) || file.includes(`${path.sep}ocr${path.sep}`)) {
          // Fonts, photos, logos and the card reader's files: a month, long
          // enough to matter on phones and short enough to pick up a change.
          res.setHeader('Cache-Control', 'public, max-age=2592000');
        } else res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    }),
  );
  // Single-page apps: every other path is a page of the site or the dashboard.
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const page = /^\/admin(?:\/|$)/.test(req.path) && existsSync(admin) ? admin : site;
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(page);
  });
  return router;
}
