import 'server-only';
import {
  createCipheriv,
  createECDH,
  createHash,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
  timingSafeEqual,
} from 'node:crypto';

export type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  badge?: number;
};

export class PushDeliveryError extends Error {
  constructor(
    public code: string,
    public status: number,
    public gone = false,
  ) {
    super(`Web Push falhou (${code}).`);
  }
}

const MAX_PLAINTEXT_BYTES = 3993;
const RECORD_SIZE = 4096;

export function base64UrlEncode(value: Buffer | Uint8Array | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function base64UrlDecode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Base64url invalido.');
  }
  const pad = (4 - (value.length % 4)) % 4;
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad), 'base64');
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function hkdfExpandSingle(prk: Buffer, info: Buffer, length: number): Buffer {
  if (length <= 0 || length > 32) throw new Error('Comprimento HKDF invalido.');
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

function assertSubscriptionKeys(subscription: StoredPushSubscription) {
  const clientPublic = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  if (clientPublic.length !== 65 || clientPublic[0] !== 4) throw new Error('Chave p256dh invalida.');
  if (authSecret.length !== 16) throw new Error('Segredo auth invalido.');
  const endpoint = new URL(subscription.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('Endpoint Web Push invalido.');
  }
  return { clientPublic, authSecret, endpoint };
}

export function validateSubscriptionInput(subscription: StoredPushSubscription): void {
  if (!subscription || typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 4096) {
    throw new Error('Assinatura Web Push invalida.');
  }
  if (typeof subscription.p256dh !== 'string' || subscription.p256dh.length > 256) {
    throw new Error('Chave p256dh invalida.');
  }
  if (typeof subscription.auth !== 'string' || subscription.auth.length > 128) {
    throw new Error('Segredo auth invalido.');
  }
  assertSubscriptionKeys(subscription);
}

export function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

export type EncryptionOptions = {
  serverPrivateKey?: Buffer;
  salt?: Buffer;
};

export function encryptWebPushPayload(
  subscription: StoredPushSubscription,
  plaintext: Buffer,
  options: EncryptionOptions = {},
) {
  const { clientPublic, authSecret } = assertSubscriptionKeys(subscription);
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Payload Web Push grande demais.');

  const ecdh = createECDH('prime256v1');
  if (options.serverPrivateKey) ecdh.setPrivateKey(options.serverPrivateKey);
  else ecdh.generateKeys();

  const serverPublic = ecdh.getPublicKey(undefined, 'uncompressed');
  if (serverPublic.length !== 65) throw new Error('Chave efemera invalida.');
  const sharedSecret = ecdh.computeSecret(clientPublic);
  const prkKey = hmac(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'ascii'),
    clientPublic,
    serverPublic,
  ]);
  const ikm = hkdfExpandSingle(prkKey, keyInfo, 32);

  const salt = options.salt ?? randomBytes(16);
  if (salt.length !== 16) throw new Error('Salt invalido.');
  const prk = hmac(salt, ikm);
  const cek = hkdfExpandSingle(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16);
  const nonce = hkdfExpandSingle(prk, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12);

  const recordPlaintext = Buffer.concat([plaintext, Buffer.from([2])]);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(recordPlaintext), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.allocUnsafe(4);
  recordSize.writeUInt32BE(RECORD_SIZE, 0);
  const body = Buffer.concat([
    salt,
    recordSize,
    Buffer.from([serverPublic.length]),
    serverPublic,
    ciphertext,
  ]);
  return { body, salt, serverPublic, cek, nonce };
}

function vapidKeys() {
  const publicValue = process.env.VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateValue = process.env.VAPID_PRIVATE_KEY?.trim() ?? '';
  if (!publicValue || !privateValue) throw new Error('VAPID nao configurado.');
  const publicKey = base64UrlDecode(publicValue);
  const privateKey = base64UrlDecode(privateValue);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || privateKey.length !== 32) {
    throw new Error('Chaves VAPID invalidas.');
  }
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(privateKey);
  const derived = ecdh.getPublicKey(undefined, 'uncompressed');
  if (derived.length !== publicKey.length || !timingSafeEqual(derived, publicKey)) {
    throw new Error('Chaves VAPID nao correspondem entre si.');
  }
  return { publicValue, publicKey, privateKey };
}


export function pushDispatchAuthorized(request: Request): boolean {
  const secret = process.env.PUSH_DISPATCH_SECRET?.trim() ?? '';
  const received = request.headers.get('authorization') ?? '';
  if (secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(received);
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}

export function pushConfigured(): boolean {
  try {
    vapidKeys();
    const app = new URL(process.env.APP_PUBLIC_URL?.trim() ?? '');
    return app.protocol === 'https:' && !app.username && !app.password;
  } catch {
    return false;
  }
}

export function vapidPublicKey(): string {
  return vapidKeys().publicValue;
}

function vapidAuthorization(endpoint: URL): string {
  const { publicValue, publicKey, privateKey } = vapidKeys();
  const x = base64UrlEncode(publicKey.subarray(1, 33));
  const y = base64UrlEncode(publicKey.subarray(33, 65));
  const d = base64UrlEncode(privateKey);
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x, y, d },
    format: 'jwk',
  });
  const now = Math.floor(Date.now() / 1000);
  const appUrl = new URL(process.env.APP_PUBLIC_URL!.trim());
  const header = base64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = base64UrlEncode(JSON.stringify({
    aud: endpoint.origin,
    exp: now + 12 * 60 * 60,
    sub: appUrl.origin,
  }));
  const input = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${input}.${base64UrlEncode(signature)}, k=${publicValue}`;
}

export async function sendWebPush(
  subscription: StoredPushSubscription,
  payload: PushPayload,
): Promise<{ providerId: string | null; status: number }> {
  validateSubscriptionInput(subscription);
  const endpoint = new URL(subscription.endpoint);
  const text = Buffer.from(JSON.stringify(payload), 'utf8');
  const { body } = encryptWebPushPayload(subscription, text);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '3600',
        Urgency: 'normal',
      },
      body: new Uint8Array(body),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new PushDeliveryError('RESULTADO_DESCONHECIDO', 502);
  }
  if (!response.ok) {
    const gone = response.status === 404 || response.status === 410;
    throw new PushDeliveryError(`HTTP_${response.status}`, response.status, gone);
  }
  return {
    providerId: response.headers.get('location') ?? response.headers.get('x-request-id'),
    status: response.status,
  };
}
