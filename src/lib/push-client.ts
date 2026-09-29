'use client';

export type BrowserPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
};

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output as Uint8Array<ArrayBuffer>;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const safariStandalone = 'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return safariStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!pushSupported()) throw new Error('Este navegador nao oferece Web Push.');
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribeBrowserPush(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permissao de notificacao nao foi concedida.');
  const registration = await registerPushServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(publicKey),
  });
}

export function serializePushSubscription(subscription: PushSubscription): BrowserPushSubscription {
  const value = subscription.toJSON();
  const p256dh = value.keys?.p256dh;
  const auth = value.keys?.auth;
  if (!value.endpoint || !p256dh || !auth) throw new Error('O navegador retornou uma assinatura incompleta.');
  return {
    endpoint: value.endpoint,
    expirationTime: value.expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

export async function clearApplicationBadge(): Promise<void> {
  if (typeof navigator === 'undefined') return;
  const badgeNavigator = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
  if (typeof badgeNavigator.clearAppBadge === 'function') {
    await badgeNavigator.clearAppBadge().catch(() => undefined);
  }
}
