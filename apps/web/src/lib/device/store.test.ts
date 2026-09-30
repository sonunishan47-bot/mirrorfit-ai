import { describe, expect, it } from 'vitest';

import {
  clearDeviceCredential,
  DEVICE_STORAGE_KEY,
  DEVICE_STORAGE_KEY_LEGACY,
  loadDeviceCredential,
  redactDeviceSecret,
  saveDeviceCredential,
  type KeyValueStore,
} from './store';

const SECRET = 'a'.repeat(43);
const DISPLAY_ID = '11111111-1111-4111-8111-111111111111';

function memoryStore(
  initial: Record<string, string> = {},
): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe('device credential persistence', () => {
  it('uses a distinct namespaced storage key', () => {
    expect(DEVICE_STORAGE_KEY).toBe('mirrorfit.kiosk.device.v1');
    expect(DEVICE_STORAGE_KEY).not.toBe(DEVICE_STORAGE_KEY_LEGACY);
    expect(DEVICE_STORAGE_KEY.startsWith('mirrorfit.kiosk.')).toBe(true);
  });

  it('returns null when nothing is stored', () => {
    expect(loadDeviceCredential(memoryStore())).toBeNull();
  });

  it('returns null when the store is unavailable', () => {
    expect(loadDeviceCredential(null)).toBeNull();
  });

  it('round-trips a well-formed credential under the scoped key only', () => {
    const store = memoryStore();
    const result = saveDeviceCredential(
      { deviceSecret: SECRET, displayId: DISPLAY_ID, displayName: 'Mirror A' },
      store,
    );

    expect(result).toEqual({ ok: true });
    expect(Object.keys(store.data)).toEqual([DEVICE_STORAGE_KEY]);
    expect(loadDeviceCredential(store)).toEqual({
      deviceSecret: SECRET,
      displayId: DISPLAY_ID,
      displayName: 'Mirror A',
    });
  });

  it('clears both current and legacy keys', () => {
    const store = memoryStore({
      [DEVICE_STORAGE_KEY]: JSON.stringify({
        deviceSecret: SECRET,
        displayId: DISPLAY_ID,
        displayName: null,
      }),
      [DEVICE_STORAGE_KEY_LEGACY]: 'stale',
    });
    clearDeviceCredential(store);
    expect(loadDeviceCredential(store)).toBeNull();
    expect(store.data[DEVICE_STORAGE_KEY]).toBeUndefined();
    expect(store.data[DEVICE_STORAGE_KEY_LEGACY]).toBeUndefined();
  });

  it('migrates a legacy key into the versioned key once', () => {
    const store = memoryStore({
      [DEVICE_STORAGE_KEY_LEGACY]: JSON.stringify({
        deviceSecret: SECRET,
        displayId: DISPLAY_ID,
        displayName: 'Mirror B',
      }),
    });
    expect(loadDeviceCredential(store)).toEqual({
      deviceSecret: SECRET,
      displayId: DISPLAY_ID,
      displayName: 'Mirror B',
    });
    expect(store.data[DEVICE_STORAGE_KEY]).toBeTruthy();
    expect(store.data[DEVICE_STORAGE_KEY_LEGACY]).toBeUndefined();
  });

  it('drops a corrupt record instead of inventing a credential', () => {
    const store = memoryStore({ [DEVICE_STORAGE_KEY]: '{"deviceSecret":"nope"}' });
    expect(loadDeviceCredential(store)).toBeNull();
    expect(store.data[DEVICE_STORAGE_KEY]).toBeUndefined();
  });

  it('refuses to persist an ill-formed secret without writing', () => {
    const store = memoryStore();
    const result = saveDeviceCredential(
      { deviceSecret: 'short', displayId: DISPLAY_ID, displayName: null },
      store,
    );
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(store.data[DEVICE_STORAGE_KEY]).toBeUndefined();
  });

  it('reports unavailable storage without throwing', () => {
    const result = saveDeviceCredential(
      { deviceSecret: SECRET, displayId: DISPLAY_ID, displayName: null },
      null,
    );
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('reports restricted storage when setItem throws', () => {
    const store: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      removeItem: () => undefined,
    };
    const result = saveDeviceCredential(
      { deviceSecret: SECRET, displayId: DISPLAY_ID, displayName: null },
      store,
    );
    expect(result).toEqual({ ok: false, reason: 'restricted' });
  });

  it('reports quota failures distinctly', () => {
    const store: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const result = saveDeviceCredential(
      { deviceSecret: SECRET, displayId: DISPLAY_ID, displayName: null },
      store,
    );
    expect(result).toEqual({ ok: false, reason: 'quota' });
  });

  it('survives getItem throwing on load', () => {
    const store: KeyValueStore = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadDeviceCredential(store)).toBeNull();
  });

  it('does not collide with unrelated keys', () => {
    const store = memoryStore({ 'mirrorfit.kiosk.other': 'keep-me' });
    saveDeviceCredential({ deviceSecret: SECRET, displayId: DISPLAY_ID, displayName: null }, store);
    expect(store.data['mirrorfit.kiosk.other']).toBe('keep-me');
    clearDeviceCredential(store);
    expect(store.data['mirrorfit.kiosk.other']).toBe('keep-me');
  });

  it('redacts secrets from telemetry strings', () => {
    const message = `heartbeat failed for ${SECRET} on display`;
    expect(redactDeviceSecret(message, SECRET)).toBe(
      'heartbeat failed for [device-secret-redacted] on display',
    );
    expect(redactDeviceSecret(message, SECRET)).not.toContain(SECRET);
  });
});
