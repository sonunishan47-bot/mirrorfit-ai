/**
 * Phone-side client for the Phase 3 claim route.
 *
 * Activate is not called here. That route authenticates a device bearer;
 * a customer's phone never holds one.
 */

export type ClaimFailureReason = 'invalid' | 'network' | 'server';

export type ClaimOutcome =
  | { readonly ok: true; readonly sessionId: string; readonly status: string }
  | { readonly ok: false; readonly reason: ClaimFailureReason };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function claimPairingSession(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<ClaimOutcome> {
  let response: Response;
  try {
    response = await fetchFn('/api/session/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (response.status === 400) {
    return { ok: false, reason: 'invalid' };
  }
  if (!response.ok) {
    return { ok: false, reason: 'server' };
  }

  const body = (await readJson(response)) as Record<string, unknown> | null;
  if (
    !body ||
    typeof body['session_id'] !== 'string' ||
    typeof body['status'] !== 'string' ||
    (body['status'] !== 'PAIRED' && body['status'] !== 'ACTIVE')
  ) {
    return { ok: false, reason: 'server' };
  }

  return {
    ok: true,
    sessionId: body['session_id'],
    status: body['status'],
  };
}
