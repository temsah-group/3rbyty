import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import { badRequest, ErrorCode } from '../../common/http/errors.js';
import { pageQuerySchema } from '../../common/http/paging.js';
import { send } from '../../common/http/response.js';
import { parseBody, parseQuery } from '../../common/http/validate.js';
import type { NotificationsService } from './notifications.service.js';
import { emailOffPage } from './email.js';

const settingsSchema = z.strictObject({
  fitsMyCar: z.boolean('validation.required'),
  priceDrops: z.boolean('validation.required'),
  news: z.boolean('validation.required'),
  email: z.boolean('validation.required').optional(),
});

const deviceSchema = z.strictObject({
  platform: z.enum(['ios', 'android', 'web'], 'validation.required'),
});

/** A push token: long, but never this long. */
function token(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 4096) {
    throw badRequest(ErrorCode.VALIDATION_FAILED, 'validation.query');
  }
  return value;
}

export function notificationsRoutes(
  notifications: NotificationsService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);
  const user = (req: { auth?: { userId: string } }) => req.auth!.userId;

  router.get('/', async (req, res) => {
    const { cursor, limit } = parseQuery(pageQuerySchema, req);
    send(res, { data: await notifications.list(user(req), req.lang, cursor, limit) });
  });

  router.post('/read-all', async (req, res) => {
    await notifications.markAllRead(user(req));
    res.status(204).end();
  });

  router.get('/settings', async (req, res) => {
    send(res, { data: await notifications.settings(user(req)) });
  });

  router.put('/settings', async (req, res) => {
    const settings = await notifications.updateSettings(user(req), parseBody(settingsSchema, req));
    send(res, { message: 'notifications.settingsSaved', data: settings });
  });

  router.put('/devices/:token', async (req, res) => {
    const { platform } = parseBody(deviceSchema, req);
    await notifications.registerDevice(user(req), token(req.params.token), platform, req.lang);
    res.status(204).end();
  });

  router.delete('/devices/:token', async (req, res) => {
    await notifications.removeDevice(user(req), req.params.token as string);
    res.status(204).end();
  });

  router.post('/:id/read', async (req, res) => {
    await notifications.markRead(user(req), req.params.id as string);
    res.status(204).end();
  });

  router.delete('/:id', async (req, res) => {
    await notifications.remove(user(req), req.params.id as string);
    res.status(204).end();
  });

  return router;
}

/**
 * `/email-off?u=&s=`, the link at the bottom of every notification email:
 * GET (someone clicking it) shows a page; POST is the one-click unsubscribe
 * mail apps send. No sign-in: the link's signature is the proof.
 */
export function emailOffRoutes(notifications: NotificationsService, siteUrl: string): Router {
  const router = Router();
  const params = (req: { query: Record<string, unknown> }) => ({
    userId: typeof req.query.u === 'string' ? req.query.u : '',
    signature: typeof req.query.s === 'string' ? req.query.s : '',
  });
  router.get('/', async (req, res) => {
    const { userId, signature } = params(req);
    const done = await notifications.emailOff(userId, signature);
    res.status(done ? 200 : 400).type('html').send(emailOffPage(req.lang, siteUrl, done));
  });
  router.post('/', async (req, res) => {
    const { userId, signature } = params(req);
    res.status((await notifications.emailOff(userId, signature)) ? 200 : 400).end();
  });
  return router;
}
