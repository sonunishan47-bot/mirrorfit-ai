/**
 * Local persistence of the enrolled device credential.
 *
 * The secret is minted by `/api/device/enroll` and stored only in this
 * browser. It is never inlined into a bundle, never written into a QR, and
 * never logged. A missing or corrupt record is treated as "not enrolled":
 * the kiosk must not invent a credential to keep the attract screen pretty.
 */

export const DEVICE_STORAGE_KEY = 'mirrorfit.kiosk.device';

export interface StoredDeviceCredential {
  readonly deviceSecret: string;
  readonly displayId: string;
  readonly displayName: string | null;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DEVICE_SECRET = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function browserStore(): KeyValueStore | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseRecord(raw: string): StoredDeviceCredential | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const deviceSecret = record['deviceSecret'];
  const displayId = record['displayId'];
  const displayName = record['displayName'];

  if (typeof deviceSecret !== 'string' || !DEVICE_SECRET.test(deviceSecret)) {
    return null;
  }
  if (typeof displayId !== 'string' || !UUID.test(displayId)) {
    return null;
  }
  if (displayName !== null && typeof displayName !== 'string') {
    return null;
  }

  return {
    deviceSecret,
    displayId,
    displayName: typeof displayName === 'string' ? displayName : null,
  };
}

export function loadDeviceCredential(
  store: KeyValueStore | null = browserStore(),
): StoredDeviceCredential | null {
  if (!store) return null;
  const raw = store.getItem(DEVICE_STORAGE_KEY);
  if (raw === null) return null;
  const parsed = parseRecord(raw);
  if (!parsed) {
    store.removeItem(DEVICE_STORAGE_KEY);
    return null;
  }
  return parsed;
}

export function saveDeviceCredential(
  credential: StoredDeviceCredential,
  store: KeyValueStore | null = browserStore(),
): void {
  if (!store) {
    throw new Error('Device storage is not available');
  }
  if (!DEVICE_SECRET.test(credential.deviceSecret) || !UUID.test(credential.displayId)) {
    throw new Error('Refusing to persist an ill-formed device credential');
  }
  store.setItem(DEVICE_STORAGE_KEY, JSON.stringify(credential));
}

export function clearDeviceCredential(store: KeyValueStore | null = browserStore()): void {
  store?.removeItem(DEVICE_STORAGE_KEY);
}
