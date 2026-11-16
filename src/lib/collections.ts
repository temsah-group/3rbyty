import { del, get, post, put, tokens } from './api';
import { carId } from './catalog';
import { persisted } from './store';
import type { GarageCar, Page, Part, Shop } from './types';

export const MAX_CARS = 5;

// ---- Garage ----

interface GarageState {
  cars: GarageCar[];
  /** Index of the car the home screen follows, or -1 for all of them. */
  active: number;
}

export const garage = persisted<GarageState>('arabity.garage', { cars: [], active: -1 });

const sameCar = (a: GarageCar, b: GarageCar) => carId(a) === carId(b);

async function pushCars() {
  if (!tokens.access) return;
  try {
    await put('/users/me/cars', { items: garage.get().cars });
  } catch {
    // Tried again on the next change or sign-in.
  }
}

export function addCar(car: GarageCar) {
  const { cars } = garage.get();
  if (cars.some((c) => sameCar(c, car)) || cars.length >= MAX_CARS) return false;
  const next = [...cars, car];
  garage.set({ cars: next, active: next.length - 1 });
  void pushCars();
  return true;
}

export function removeCar(index: number) {
  const { cars, active } = garage.get();
  const next = cars.filter((_, i) => i !== index);
  garage.set({ cars: next, active: active === index || active >= next.length ? -1 : active });
  void pushCars();
}

export function followCar(index: number) {
  garage.set({ ...garage.get(), active: index });
}

/** The cars the home screen and searches use. */
export function followedCars(state: GarageState) {
  if (state.active >= 0 && state.cars[state.active]) return [state.cars[state.active]];
  return state.cars;
}

/** After sign-in: the device's cars and the account's, together. */
async function syncGarage() {
  const server = await get<{ items: GarageCar[] }>('/users/me/cars');
  const merged = [...server.items];
  for (const car of garage.get().cars) {
    if (merged.length < MAX_CARS && !merged.some((c) => sameCar(c, car))) merged.push(car);
  }
  garage.set({ cars: merged, active: -1 });
  if (merged.length !== server.items.length) await put('/users/me/cars', { items: merged });
}

// ---- Saved parts ----

export const saved = persisted<string[]>('arabity.saved', []);

/** Saving needs an account; the caller asks the guest to sign in first. */
export async function toggleSaved(partId: string) {
  if (!tokens.access) throw new Error('Sign in to save parts');
  const ids = saved.get();
  const isSaved = ids.includes(partId);
  saved.set(isSaved ? ids.filter((id) => id !== partId) : [partId, ...ids]);
  try {
    if (isSaved) await del(`/users/me/saved/${partId}`);
    else await put(`/users/me/saved/${partId}`);
  } catch (error) {
    saved.set(ids);
    throw error;
  }
  return !isSaved;
}

async function syncSaved() {
  const local = saved.get();
  // Oldest saved first, as the server expects.
  if (local.length) await post('/users/me/saved/sync', { partIds: [...local].reverse().slice(-200) });
  const ids: string[] = [];
  let cursor: string | null | undefined;
  for (let i = 0; i < 4; i++) {
    const page: Page<Part> = await get('/users/me/saved', { limit: 50, cursor });
    ids.push(...page.items.map((p) => p.id));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  saved.set(ids);
}

// ---- Saved shops ----

export const savedShops = persisted<string[]>('arabity.savedShops', []);

/** Like saved parts: needs an account, and rolls back if the server says no. */
export async function toggleSavedShop(shopId: string) {
  if (!tokens.access) throw new Error('Sign in to save shops');
  const ids = savedShops.get();
  const isSaved = ids.includes(shopId);
  savedShops.set(isSaved ? ids.filter((id) => id !== shopId) : [shopId, ...ids]);
  try {
    if (isSaved) await del(`/users/me/saved-shops/${shopId}`);
    else await put(`/users/me/saved-shops/${shopId}`);
  } catch (error) {
    savedShops.set(ids);
    throw error;
  }
  return !isSaved;
}

async function syncSavedShops() {
  const local = savedShops.get();
  if (local.length) await post('/users/me/saved-shops/sync', { shopIds: [...local].reverse().slice(-200) });
  const ids: string[] = [];
  let cursor: string | null | undefined;
  for (let i = 0; i < 4; i++) {
    const page: Page<Shop> = await get('/users/me/saved-shops', { limit: 50, cursor });
    ids.push(...page.items.map((s) => s.id));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  savedShops.set(ids);
}

// ---- Recently viewed (device only) ----

export const recent = persisted<string[]>('arabity.recent', []);

export function markViewed(partId: string) {
  recent.set([partId, ...recent.get().filter((id) => id !== partId)].slice(0, 12));
}

// ---- Sign-in / sign-out ----

export async function syncAfterSignIn() {
  await Promise.allSettled([syncGarage(), syncSaved(), syncSavedShops()]);
}

/** Signing out leaves the account's lists with the account. */
export function clearAccountCollections() {
  saved.set([]);
  savedShops.set([]);
  garage.set({ cars: [], active: -1 });
}
