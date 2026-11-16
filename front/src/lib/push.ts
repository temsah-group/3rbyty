import type { FirebaseApp } from 'firebase/app';

import { del, put, tokens } from './api';
import { persisted } from './store';

/**
 * Browser push through Firebase Cloud Messaging. The keys are public (Firebase
 * console > Project settings > General > Web app, and Cloud Messaging > Web
 * Push certificates). Any of them empty hides the whole feature.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

/** The service worker in `public/` that shows the pushes and opens them on a tap. */
const WORKER_URL = '/push-sw.js';

/** This browser's push token while it pushes to the signed-in account. */
export const pushToken = persisted<string | null>('arabity.pushToken', null);

const configured = () =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId && VAPID_KEY);

/** False when keys are missing or the browser can't do web push (e.g. iPhone Safari outside the home screen). */
export function pushSupported(): boolean {
  return configured() && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

export function pushState(token: string | null): PushState {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && token ? 'on' : 'off';
}

let app: FirebaseApp | undefined;

async function messaging() {
  const [{ initializeApp }, fcm] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  if (!(await fcm.isSupported())) throw new Error('Push is not supported in this browser');
  app ??= initializeApp(firebaseConfig);
  return { fcm, instance: fcm.getMessaging(app) };
}

const devicePath = (token: string) => `/notifications/devices/${encodeURIComponent(token)}`;

/** Gets this browser's token and gives it to the account, in the current language. */
async function register() {
  const { fcm, instance } = await messaging();
  const registration = await navigator.serviceWorker.register(WORKER_URL);
  const token = await fcm.getToken(instance, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error('No push token');
  const old = pushToken.get();
  if (old && old !== token) await del(devicePath(old)).catch(() => undefined);
  await put(devicePath(token), { platform: 'web' });
  pushToken.set(token);
}

/** Asks the browser for permission, then registers. False when the user said no. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported() || !tokens.access) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  await register();
  return true;
}

/** Stops pushes to this browser. */
export async function disablePush() {
  const token = pushToken.get();
  pushToken.set(null);
  if (!token) return;
  await del(devicePath(token)).catch(() => undefined);
  try {
    const { fcm, instance } = await messaging();
    await fcm.deleteToken(instance);
  } catch {
    // The server no longer has it either way.
  }
}

/**
 * After sign-in or a language change: registers again, so the token stays on
 * this account and pushes come in the site's language.
 */
export async function refreshPush() {
  if (!pushSupported() || Notification.permission !== 'granted' || !pushToken.get() || !tokens.access) return;
  try {
    await register();
  } catch {
    // Tried again next time.
  }
}

/** On sign-out: the next account on this browser opts in for itself. */
export async function forgetPushDevice() {
  const token = pushToken.get();
  pushToken.set(null);
  if (token && tokens.access) await del(devicePath(token)).catch(() => undefined);
}
