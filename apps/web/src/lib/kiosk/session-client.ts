/**
 * Thin client for the Phase 3 session and enroll routes.
 *
 * No new lifecycle operations. Tenancy identifiers are never sent: the
 * server resolves display, shop and organization from the device secret.
 */

export interface CreatedKioskSession {
  readonly sessionId: string;
  readonly status: string;
  readonly pairingUrl: string;
  readonly pairingExpiresAt: string;
}

export interface SelectedKioskGarment {
  readonly garmentId: string;
  readonly variantId: string;
  readonly category?: string | null;
  readonly isTestFixture?: boolean;
}

export interface LiveKioskSession {
  readonly sessionId: string;
  readonly status: string;
  readonly pairingExpiresAt: string | null;
  readonly selectedGarment?: SelectedKioskGarment | null;
}

export interface EnrolledDevice {
  readonly deviceSecret: string;
  readonly displayId: string;
  readonly displayName: string | null;
}

function bearerHeaders(secret: string): HeadersInit {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${secret}`,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function enrollDevice(
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<EnrolledDevice> {
  const response = await fetchFn('/api/device/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = (await readJson(response)) as Record<string, unknown> | null;
  if (!response.ok || !body || typeof body['device_secret'] !== 'string') {
    throw new Error('Enrollment failed');
  }
  const display = body['display'] as Record<string, unknown> | undefined;
  if (!display || typeof display['id'] !== 'string') {
    throw new Error('Enrollment failed');
  }
  return {
    deviceSecret: body['device_secret'],
    displayId: display['id'],
    displayName: typeof display['name'] === 'string' ? display['name'] : null,
  };
}

export async function createKioskSession(
  secret: string,
  fetchFn: typeof fetch = fetch,
): Promise<CreatedKioskSession> {
  const response = await fetchFn('/api/session/create', {
    method: 'POST',
    headers: bearerHeaders(secret),
    body: JSON.stringify({}),
  });
  const body = (await readJson(response)) as Record<string, unknown> | null;
  if (
    !response.ok ||
    !body ||
    typeof body['session_id'] !== 'string' ||
    typeof body['pairing_url'] !== 'string' ||
    typeof body['pairing_expires_at'] !== 'string' ||
    typeof body['status'] !== 'string'
  ) {
    throw new Error('Session create failed');
  }
  return {
    sessionId: body['session_id'],
    status: body['status'],
    pairingUrl: body['pairing_url'],
    pairingExpiresAt: body['pairing_expires_at'],
  };
}

export async function readLiveSession(
  secret: string,
  fetchFn: typeof fetch = fetch,
): Promise<LiveKioskSession | null> {
  const response = await fetchFn('/api/session/current', {
    headers: { authorization: `Bearer ${secret}` },
  });
  if (response.status === 401) {
    throw new Error('UNAUTHORIZED');
  }
  if (!response.ok) {
    return null;
  }
  const body = (await readJson(response)) as Record<string, unknown> | null;
  const session = body?.['session'];
  if (!session || typeof session !== 'object') {
    return null;
  }
  const record = session as Record<string, unknown>;
  if (typeof record['session_id'] !== 'string' || typeof record['status'] !== 'string') {
    return null;
  }
  return {
    sessionId: record['session_id'],
    status: record['status'],
    pairingExpiresAt:
      typeof record['pairing_expires_at'] === 'string' ? record['pairing_expires_at'] : null,
    selectedGarment: readSelectedGarment(record['selected_garment']),
  };
}

function readSelectedGarment(value: unknown): SelectedKioskGarment | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row['garment_id'] !== 'string' || typeof row['variant_id'] !== 'string') {
    return null;
  }
  return {
    garmentId: row['garment_id'],
    variantId: row['variant_id'],
    category: typeof row['category'] === 'string' ? row['category'] : null,
    isTestFixture: row['is_test_fixture'] === true,
  };
}

export async function activateKioskSession(
  secret: string,
  sessionId: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchFn('/api/session/activate', {
    method: 'POST',
    headers: bearerHeaders(secret),
    body: JSON.stringify({ session_id: sessionId }),
  });
  return response.ok;
}

export async function endKioskSession(
  secret: string,
  sessionId: string,
  reason: 'CUSTOMER_ENDED' | 'DISCONNECTED' | 'ERROR',
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await fetchFn('/api/session/end', {
    method: 'POST',
    headers: bearerHeaders(secret),
    body: JSON.stringify({ session_id: sessionId, reason }),
  });
}

/**
 * Maps a status poll onto a kiosk event. Does not call activate or end;
 * the shell does that after the machine accepts the event.
 */
export function eventFromLiveSession(
  live: LiveKioskSession | null,
  localSessionId: string | null,
  nowMs: number,
): 'PAIRING_CLAIMED' | 'SESSION_ENDED' | null {
  if (!localSessionId) return null;

  if (!live || live.sessionId !== localSessionId) {
    return 'SESSION_ENDED';
  }

  if (live.status === 'ENDED' || live.status === 'EXPIRED') {
    return 'SESSION_ENDED';
  }

  if (live.status === 'WAITING' && live.pairingExpiresAt) {
    const expires = Date.parse(live.pairingExpiresAt);
    if (!Number.isNaN(expires) && expires <= nowMs) {
      return 'SESSION_ENDED';
    }
  }

  if (live.status === 'PAIRED' || live.status === 'ACTIVE') {
    return 'PAIRING_CLAIMED';
  }

  return null;
}
