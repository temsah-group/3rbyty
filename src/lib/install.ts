/**
 * "Install the site as an app". Chrome and Edge (Android and desktop) offer
 * their own install dialog through `beforeinstallprompt`, which can fire
 * before React has mounted, so it is caught here as soon as the app loads.
 * iPhone Safari has no such event: it is installed from the Share menu.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Our own banner asks at a better moment than the browser's mini-bar.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    remember(INSTALLED);
    changed();
  });
}

export const canPrompt = () => deferred !== null;

export function onInstallChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Opens the browser's install dialog; true when the visitor installed. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  changed();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === 'accepted';
}

/** Already running as the installed app. */
export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Safari on an iPhone or iPad, the only browser there that can install. */
export function isIosSafari() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram/.test(ua);
}

const KEY = 'install-banner';
const INSTALLED = -1;
const QUIET_DAYS = 21;

function remember(value: number) {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    // Private mode: the banner just comes back next visit.
  }
}

/** Closed recently, or installed: don't ask. */
export function bannerSnoozed() {
  try {
    const value = Number(localStorage.getItem(KEY) ?? 0);
    return value === INSTALLED || Date.now() - value < QUIET_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export const snoozeBanner = () => remember(Date.now());
export const markInstalled = () => remember(INSTALLED);
