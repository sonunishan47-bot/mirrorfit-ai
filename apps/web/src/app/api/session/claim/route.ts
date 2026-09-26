import { NextResponse } from 'next/server';

import {
  claimedSessionSchema,
  parseJsonBody,
  sessionClaimRequestSchema,
} from '@mirrorfit/validation';

import { clientError } from '@/lib/api/errors';
import { claimRateLimiter, clientIpFromRequest } from '@/lib/api/rate-limit';
import { sha256Hex } from '@/lib/crypto/secrets';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

export const dynamic = 'force-dynamic';

/**
 * A customer's phone claims the session behind a scanned QR code.
 *
 * Unauthenticated by necessity: the customer installs nothing and has no
 * account, so the token is the entire credential. What makes that acceptable
 * is the token's properties, not the endpoint's: 256 bits of randomness, a
 * two-minute life, stored only as a hash, and single-use.
 *
 * Single-use is enforced by one conditional UPDATE inside the database
 * function. Two phones racing on the same code both run it, Postgres
 * serialises them on the row, and the second matches no rows. There is no
 * read-then-write window here for them to interleave in.
 *
 * Every failure returns the same code. Distinguishing "expired" from
 * "already claimed" from "never existed" would tell someone walking a token
 * space that a guess had been correct at some point.
 *
 * The response is deliberately thin. A phone needs the session it is now
 * attached to and the language to render in; it does not need the display,
 * shop or organization behind it, so none of those are disclosed.
 *
 * In-process IP rate limit (30/min) is a cost backstop. Phase 15 still needs
 * a distributed limiter for multi-instance deploys.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const limited = claimRateLimiter.check(clientIpFromRequest(request));
  if (!limited.ok) {
    return clientError('RATE_LIMITED', { retryAfterMs: limited.retryAfterMs });
  }

  const parsed = await parseJsonBody(sessionClaimRequestSchema, request);
  // A malformed token and a wrong one are the same answer, so a caller
  // cannot use the shape of the rejection to learn what a real token looks
  // like.
  if (!parsed.ok) {
    return clientError('INVALID_TOKEN');
  }

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc('claim_session_pairing_token', {
    p_token_hash: sha256Hex(parsed.data.token),
  });

  if (error || !data) {
    return clientError('INVALID_TOKEN');
  }

  const claimed = claimedSessionSchema.safeParse(data);
  if (!claimed.success) {
    return clientError('INTERNAL');
  }

  return NextResponse.json(
    {
      session_id: claimed.data.session_id,
      status: claimed.data.status,
      locale: claimed.data.locale,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
