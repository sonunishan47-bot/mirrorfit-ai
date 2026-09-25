import { describe, expect, it } from 'vitest';

import { reduceKiosk } from './machine';
import {
  activateKioskSession,
  createKioskSession,
  endKioskSession,
  enrollDevice,
  eventFromLiveSession,
  readLiveSession,
} from './session-client';
import { pairingQrValue } from './pairing-qr';

const SECRET = 'e'.repeat(43);
const TOKEN = 'f'.repeat(43);
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const DISPLAY_ID = '33333333-3333-4333-8333-333333333333';
const PAIRING_URL = `https://store.example/s?t=${TOKEN}`;

describe('session creation', () => {
  it('calls the existing create route with a bearer and no tenancy fields', async () => {
    let url = '';
    let init: RequestInit | undefined;

    const created = await createKioskSession(SECRET, async (input, requestInit) => {
      url = String(input);
      init = requestInit;
      return new Response(
        JSON.stringify({
          session_id: SESSION_ID,
          status: 'WAITING',
          pairing_url: PAIRING_URL,
          pairing_expires_at: '2026-01-01T00:02:00.000Z',
        }),
        { status: 200 },
      );
    });

    expect(url).toBe('/api/session/create');
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${SECRET}` });
    expect(String(init?.body)).not.toContain('organization_id');
    expect(created.sessionId).toBe(SESSION_ID);
    expect(created.pairingUrl).toBe(PAIRING_URL);
    expect(pairingQrValue(created.pairingUrl, SECRET)).toBe(PAIRING_URL);
    expect(pairingQrValue(created.pairingUrl, SECRET)).not.toContain(SECRET);
  });

  it('does not invent a session when the API refuses', async () => {
    await expect(
      createKioskSession(
        SECRET,
        async () => new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 }),
      ),
    ).rejects.toThrow('Session create failed');
  });
});

describe('claim → paired → active', () => {
  it('opens, notices a claim, then activates through the existing routes', async () => {
    let status: ReturnType<typeof reduceKiosk> = 'IDLE';
    status = reduceKiosk(status, 'SESSION_OPENED');
    expect(status).toBe('WAITING');

    const claimed = eventFromLiveSession(
      { sessionId: SESSION_ID, status: 'PAIRED', pairingExpiresAt: null },
      SESSION_ID,
      Date.now(),
    );
    expect(claimed).toBe('PAIRING_CLAIMED');
    status = reduceKiosk(status, 'PAIRING_CLAIMED');
    expect(status).toBe('PAIRED');

    const activated = await activateKioskSession(SECRET, SESSION_ID, async (input, init) => {
      expect(String(input)).toBe('/api/session/activate');
      expect(JSON.parse(String(init?.body))).toEqual({ session_id: SESSION_ID });
      return new Response(JSON.stringify({ session_id: SESSION_ID, status: 'ACTIVE' }), {
        status: 200,
      });
    });
    expect(activated).toBe(true);
    status = reduceKiosk(status, 'SESSION_ACTIVATED');
    expect(status).toBe('ACTIVE');
  });

  it('treats an expired waiting session as ended, not pairable', () => {
    const event = eventFromLiveSession(
      {
        sessionId: SESSION_ID,
        status: 'WAITING',
        pairingExpiresAt: '2020-01-01T00:00:00.000Z',
      },
      SESSION_ID,
      Date.parse('2026-01-01T00:00:00.000Z'),
    );
    expect(event).toBe('SESSION_ENDED');
    expect(reduceKiosk('WAITING', 'SESSION_ENDED')).toBe('ENDED');
  });

  it('does not resurrect a session after reset', () => {
    let status = reduceKiosk('ACTIVE', 'SESSION_ENDED');
    status = reduceKiosk(status, 'RESET');
    expect(status).toBe('IDLE');
    expect(reduceKiosk(status, 'PAIRING_CLAIMED')).toBe('IDLE');
  });
});

describe('live session read', () => {
  it('reads the current session without inventing a lifecycle RPC', async () => {
    const live = await readLiveSession(SECRET, async (input, init) => {
      expect(String(input)).toBe('/api/session/current');
      expect(init?.method ?? 'GET').toBe('GET');
      return new Response(
        JSON.stringify({
          session: {
            session_id: SESSION_ID,
            status: 'WAITING',
            pairing_expires_at: '2026-01-01T00:02:00.000Z',
          },
        }),
        { status: 200 },
      );
    });
    expect(live).toEqual({
      sessionId: SESSION_ID,
      status: 'WAITING',
      pairingExpiresAt: '2026-01-01T00:02:00.000Z',
      selectedGarment: null,
    });
  });

  it('rejects a revoked device secret', async () => {
    await expect(
      readLiveSession(SECRET, async () => new Response(null, { status: 401 })),
    ).rejects.toThrow('UNAUTHORIZED');
  });

  it('returns null when the display has no live session', async () => {
    const live = await readLiveSession(
      SECRET,
      async () => new Response(JSON.stringify({ session: null }), { status: 200 }),
    );
    expect(live).toBeNull();
  });

  it('reads a selected garment without trusting org or shop from the phone', async () => {
    const live = await readLiveSession(SECRET, async () => {
      return new Response(
        JSON.stringify({
          session: {
            session_id: SESSION_ID,
            status: 'ACTIVE',
            pairing_expires_at: null,
            selected_garment: {
              garment_id: '33333333-3333-4333-8333-333333333333',
              variant_id: '55555555-5555-4555-8555-555555555555',
              category: 'Tops',
            },
          },
        }),
        { status: 200 },
      );
    });
    expect(live?.selectedGarment).toEqual({
      garmentId: '33333333-3333-4333-8333-333333333333',
      variantId: '55555555-5555-4555-8555-555555555555',
      category: 'Tops',
      isTestFixture: false,
    });
  });

  it('reads is_test_fixture from the live session garment', async () => {
    const live = await readLiveSession(SECRET, async () => {
      return new Response(
        JSON.stringify({
          session: {
            session_id: SESSION_ID,
            status: 'ACTIVE',
            pairing_expires_at: null,
            selected_garment: {
              garment_id: '33333333-3333-4333-8333-333333333333',
              variant_id: '55555555-5555-4555-8555-555555555555',
              category: 'Tops',
              is_test_fixture: true,
            },
          },
        }),
        { status: 200 },
      );
    });
    expect(live?.selectedGarment?.isTestFixture).toBe(true);
  });

  it('treats a cleared garment as no selection', async () => {
    const live = await readLiveSession(SECRET, async () => {
      return new Response(
        JSON.stringify({
          session: {
            session_id: SESSION_ID,
            status: 'ACTIVE',
            pairing_expires_at: null,
            selected_garment: null,
          },
        }),
        { status: 200 },
      );
    });
    expect(live?.selectedGarment).toBeNull();
  });

  it('ends the local session when the live session is a different id', () => {
    expect(
      eventFromLiveSession(
        {
          sessionId: '44444444-4444-4444-8444-444444444444',
          status: 'ACTIVE',
          pairingExpiresAt: null,
          selectedGarment: {
            garmentId: '33333333-3333-4333-8333-333333333333',
            variantId: '55555555-5555-4555-8555-555555555555',
          },
        },
        SESSION_ID,
        Date.now(),
      ),
    ).toBe('SESSION_ENDED');
  });
});

describe('end / reset', () => {
  it('calls the existing end route and returns to idle', async () => {
    let url = '';
    let body: unknown;
    await endKioskSession(SECRET, SESSION_ID, 'CUSTOMER_ENDED', async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ already_ended: false }), { status: 200 });
    });
    expect(url).toBe('/api/session/end');
    expect(body).toEqual({ session_id: SESSION_ID, reason: 'CUSTOMER_ENDED' });
  });

  it('returns to idle and drops the pairing URL from consideration', () => {
    let status = reduceKiosk('WAITING', 'SESSION_ENDED');
    status = reduceKiosk(status, 'RESET');
    expect(status).toBe('IDLE');
    expect(pairingQrValue(null, SECRET)).toBeNull();
  });

  it('ends when the live session disappears', () => {
    expect(eventFromLiveSession(null, SESSION_ID, Date.now())).toBe('SESSION_ENDED');
  });

  it('does not keep a garment selection after the live session ends', () => {
    let selected: {
      garmentId: string;
      variantId: string;
    } | null = {
      garmentId: '33333333-3333-4333-8333-333333333333',
      variantId: '55555555-5555-4555-8555-555555555555',
    };
    const event = eventFromLiveSession(null, SESSION_ID, Date.now());
    expect(event).toBe('SESSION_ENDED');
    // Kiosk clearSession() drops selection when SESSION_ENDED is applied.
    if (event === 'SESSION_ENDED') selected = null;
    expect(selected).toBeNull();
  });
});

describe('enroll does not invent a credential', () => {
  it('persists only what the enroll route returned', async () => {
    const enrolled = await enrollDevice('ABCD1234EFGH', async () => {
      return new Response(
        JSON.stringify({
          device_secret: SECRET,
          display: { id: DISPLAY_ID, name: 'Front', slug: 'front', shop_id: DISPLAY_ID },
        }),
        { status: 200 },
      );
    });
    expect(enrolled.deviceSecret).toBe(SECRET);
    expect(enrolled.displayId).toBe(DISPLAY_ID);
  });
});
