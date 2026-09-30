/**
 * Local persistence of the enrolled device credential.
 *
 * The secret is minted by `/api/device/enroll` and stored only in this
 * browser under a single, namespaced key. It is never inlined into a bundle,
 * never written into a QR, and never logged. A missing, corrupt, or
 * inaccessible store is treated as "not enrolled": the kiosk must not invent
 * a credential to keep the attract screen pretty.
 */

/** Sole localStorage key for the enrolled kiosk credential. Do not reuse. */
export const DEVICE_STORAGE_KEY = 'mirrorfit.kiosk.device.v1';

/**
 * Legacy key from earlier builds. Migrated once into DEVICE_STORAGE_KEY then removed.
 * Kept only so upgrades do not force re-enrollment.
 */
export const DEVICE_STORAGE_KEY_LEGACY = 'mirrorfit.kiosk.device';

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

export type DeviceStorageFailureReason = 'unavailable' | 'invalid' | 'quota' | 'restricted';

export type SaveDeviceCredentialResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: DeviceStorageFailureReason };

const DEVICE_SECRET = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function browserStore(): KeyValueStore | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    // Probe accessibility (private mode / blocked storage can throw on use).
    const probeKey = `${DEVICE_STORAGE_KEY}.__probe`;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

function safeGetItem(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(
  store: KeyValueStore,
  key: string,
  value: string,
): DeviceStorageFailureReason | null {
  try {
    store.setItem(key, value);
    return null;
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return 'quota';
    }
    return 'restricted';
  }
}

function safeRemoveItem(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // Best-effort clear.
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

/**
 * Redacts a device secret from telemetry / console strings.
 * Never use the raw secret in logs.
 */
export function redactDeviceSecret(text: string, secret: string | null | undefined): string {
  if (!secret || secret.length < 8) return text;
  return text.split(secret).join('[device-secret-redacted]');
}

export function loadDeviceCredential(
  store: KeyValueStore | null = browserStore(),
): StoredDeviceCredential | null {
  if (!store) return null;

  const current = safeGetItem(store, DEVICE_STORAGE_KEY);
  if (current !== null) {
    const parsed = parseRecord(current);
    if (!parsed) {
      safeRemoveItem(store, DEVICE_STORAGE_KEY);
      return null;
    }
    return parsed;
  }

  // One-time migration from the legacy key.
  const legacy = safeGetItem(store, DEVICE_STORAGE_KEY_LEGACY);
  if (legacy === null) return null;
  const parsedLegacy = parseRecord(legacy);
  safeRemoveItem(store, DEVICE_STORAGE_KEY_LEGACY);
  if (!parsedLegacy) return null;
  const writeError = safeSetItem(store, DEVICE_STORAGE_KEY, JSON.stringify(parsedLegacy));
  if (writeError) return parsedLegacy;
  return parsedLegacy;
}

/**
 * Persists a validated credential. Returns a structured result so callers can
 * show a clear message when storage is blocked — never invents a secret.
 */
export function saveDeviceCredential(
  credential: StoredDeviceCredential,
  store: KeyValueStore | null = browserStore(),
): SaveDeviceCredentialResult {
  if (!store) {
    return { ok: false, reason: 'unavailable' };
  }
  if (!DEVICE_SECRET.test(credential.deviceSecret) || !UUID.test(credential.displayId)) {
    return { ok: false, reason: 'invalid' };
  }
  const payload = JSON.stringify({
    deviceSecret: credential.deviceSecret,
    displayId: credential.displayId,
    displayName: credential.displayName,
  });
  const writeError = safeSetItem(store, DEVICE_STORAGE_KEY, payload);
  if (writeError) {
    return { ok: false, reason: writeError };
  }
  // Avoid leaving a stale legacy copy that could diverge.
  safeRemoveItem(store, DEVICE_STORAGE_KEY_LEGACY);
  return { ok: true };
}

export function clearDeviceCredential(store: KeyValueStore | null = browserStore()): void {
  if (!store) return;
  safeRemoveItem(store, DEVICE_STORAGE_KEY);
  safeRemoveItem(store, DEVICE_STORAGE_KEY_LEGACY);
}
