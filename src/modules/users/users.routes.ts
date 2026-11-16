import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { AppError, badRequest, ErrorCode } from '../../common/http/errors.js';
import { send } from '../../common/http/response.js';
import { parseBody } from '../../common/http/validate.js';
import { fullName, password, phone } from '../auth/auth.schemas.js';
import { resolveCar, yearFits } from '../catalog/car-ref.js';
import type { AccountService } from './account.service.js';
import { MAX_PHOTO_MB, photoExtension } from './photo-storage.js';
import { presentUser } from './user.presenter.js';
import type { UsersService } from './users.service.js';

const updateProfileSchema = z.strictObject({
  fullName: fullName.optional(),
  phone: phone.optional(),
});

// A Google account with no password yet sets its first one without `currentPassword`.
const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string('validation.required').min(1, 'validation.required').optional(),
    newPassword: password,
    confirmPassword: z.string('validation.required'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'validation.passwordMismatch',
    path: ['confirmPassword'],
  });

export const MAX_CARS = 5;

/**
 * The garage: each car once, a catalog make and model or ones typed by hand
 * (`brandId: "other"` with `brandName`, or a `modelName`), in a year from
 * 1950 to the model's last.
 */
const carsSchema = z.strictObject({
  items: z
    .array(
      z
        .strictObject({
          brandId: z.string('validation.car'),
          brandName: z.string('validation.car').max(60, 'validation.car').nullish(),
          modelId: z.string('validation.car').nullish(),
          modelName: z.string('validation.car').max(60, 'validation.car').nullish(),
          year: z.number('validation.car').int('validation.car'),
        })
        .transform((value, ctx) => {
          const car = resolveCar(value);
          // A garage car needs a model, from the list or typed.
          if (!car || (!car.modelId && !car.modelKey) || !yearFits(car.model, value.year)) {
            ctx.addIssue({ code: 'custom', message: 'validation.car' });
            return z.NEVER;
          }
          const { model: _model, ...ref } = car;
          return { ...ref, year: value.year };
        }),
      'validation.car',
    )
    .refine(
      (cars) =>
        new Set(cars.map((car) => `${car.brandKey ?? car.brandId}:${car.modelId ?? car.modelKey}:${car.year}`)).size === cars.length,
      'validation.car',
    ),
});

type StoredCar = { brandId: string; brandName?: string | null; modelId?: string | null; modelName?: string | null; year: number };
const presentCars = (user: { cars?: StoredCar[] }) => ({
  items: (user.cars ?? []).map((car) => ({
    brandId: car.brandId,
    brandName: car.brandName ?? null,
    modelId: car.modelId ?? null,
    modelName: car.modelName ?? null,
    year: car.year,
  })),
});

/** The password, or for an account without one a fresh Google ID token. */
const deleteAccountSchema = z.strictObject({
  password: z.string('validation.required').min(1, 'validation.required').optional(),
  idToken: z.string('validation.required').min(1, 'validation.required').max(4096).optional(),
});

/** One image in the `photo` field, kept in memory until it is checked. */
export const photoUpload: RequestHandler = (req, res, next) => {
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024, files: 1, fields: 0 },
  }).single('photo')(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(
        new AppError(413, ErrorCode.PHOTO_TOO_LARGE, 'users.photoTooLarge', [MAX_PHOTO_MB]),
      );
    }
    if (error instanceof multer.MulterError) {
      return next(badRequest(ErrorCode.PHOTO_REQUIRED, 'users.photoRequired'));
    }
    next(error);
  });
};

export function usersRoutes(
  users: UsersService,
  account: AccountService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/me', async (req, res) => {
    send(res, { data: presentUser(await users.getById(req.auth!.userId)) });
  });

  router.patch('/me', async (req, res) => {
    const changes = parseBody(updateProfileSchema, req);
    const user = await users.updateProfile(req.auth!.userId, changes);
    send(res, { message: 'users.profileUpdated', data: presentUser(user) });
  });

  router.patch('/me/password', async (req, res) => {
    const input = parseBody(changePasswordSchema, req);
    const { userId, sessionId } = req.auth!;
    await account.changePassword(userId, sessionId, input);
    send(res, { message: 'users.passwordChanged' });
  });

  router.delete('/me', async (req, res) => {
    await account.deleteAccount(req.auth!.userId, parseBody(deleteAccountSchema, req));
    send(res, { message: 'users.accountDeleted' });
  });

  router.get('/me/cars', async (req, res) => {
    send(res, { data: presentCars(await users.getById(req.auth!.userId)) });
  });

  router.put('/me/cars', async (req, res) => {
    const { items } = parseBody(carsSchema, req);
    if (items.length > MAX_CARS) {
      throw badRequest(ErrorCode.TOO_MANY_CARS, 'users.tooManyCars', [MAX_CARS]);
    }
    const user = await users.getById(req.auth!.userId);
    user.set('cars', items);
    await user.save();
    send(res, { message: 'users.carsSaved', data: presentCars(user) });
  });

  router.post('/me/photo', photoUpload, async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest(ErrorCode.PHOTO_REQUIRED, 'users.photoRequired');
    const extension = photoExtension(file.buffer);
    if (!extension) throw badRequest(ErrorCode.PHOTO_INVALID, 'users.photoInvalid');
    const user = await account.setPhoto(req.auth!.userId, file.buffer, extension);
    send(res, { message: 'users.photoUpdated', data: presentUser(user) });
  });

  router.delete('/me/photo', async (req, res) => {
    const user = await account.removePhoto(req.auth!.userId);
    send(res, { message: 'users.photoRemoved', data: presentUser(user) });
  });

  return router;
}
