import { describe, expect, it } from 'vitest';

import {
  clearDeviceCredential,
  DEVICE_STORAGE_KEY,
  loadDeviceCredential,
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
  it('returns null when nothing is stored', () => {
    expect(loadDeviceCredential(memoryStore())).toBeNull();
  });

  it('round-trips a well-formed credential', () => {
    const store = memoryStore();
    saveDeviceCredential(
      { deviceSecret: SECRET, displayId: DISPLAY_ID, displayName: 'Mirror A' },
      store,
    );

    expect(loadDeviceCredential(store)).toEqual({
      deviceSecret: SECRET,
      displayId: DISPLAY_ID,
      displayName: 'Mirror A',
    });
  });

  it('clears the stored credential', () => {
    const store = memoryStore();
    saveDeviceCredential({ deviceSecret: SECRET, displayId: DISPLAY_ID, displayName: null }, store);
    clearDeviceCredential(store);
    expect(loadDeviceCredential(store)).toBeNull();
    expect(store.data[DEVICE_STORAGE_KEY]).toBeUndefined();
  });

  it('drops a corrupt record instead of inventing a credential', () => {
    const store = memoryStore({ [DEVICE_STORAGE_KEY]: '{"deviceSecret":"nope"}' });
    expect(loadDeviceCredential(store)).toBeNull();
    expect(store.data[DEVICE_STORAGE_KEY]).toBeUndefined();
  });

  it('refuses to persist an ill-formed secret', () => {
    const store = memoryStore();
    expect(() =>
      saveDeviceCredential(
        { deviceSecret: 'short', displayId: DISPLAY_ID, displayName: null },
        store,
      ),
    ).toThrow();
    expect(store.data[DEVICE_STORAGE_KEY]).toBeUndefined();
  });
});
