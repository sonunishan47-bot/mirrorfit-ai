import { NextResponse } from 'next/server';

import { endedSessionSchema, parseJsonBody, sessionEndRequestSchema } from '@mirrorfit/validation';

import { clientError } from '@/lib/api/errors';
import { authenticateDevice } from '@/lib/device/authenticate';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

export const dynamic = 'force-dynamic';

/**
 * A mirror ends a session and returns to the QR screen.
 *
 * The body names a session, but naming one is not the same as being allowed
 * to end it. The database function takes the display id from the credential
 * alongside the session id and matches on both, so a mirror can only
 * terminate its own sessions. A session id is not a capability.
 *
 * The reason is restricted to the three a device can honestly report.
 * `TIMEOUT` belongs to the expiry sweep and `STAFF_RESET` to a staff action;
 * letting a device claim either would let it write a misleading history of
 * its own sessions.
 *
 * Ending is idempotent. A mirror that lost the response to its first call
 * retries and gets the original outcome back rather than an error, and the
 * first recorded reason is never overwritten.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const device = await authenticateDevice(request);
  if (!device) {
    return clientError('UNAUTHORIZED');
  }

  const parsed = await parseJsonBody(sessionEndRequestSchema, request);
  if (!parsed.ok) {
    return clientError('INVALID_REQUEST');
  }

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc('end_display_session', {
    p_session_id: parsed.data.session_id,
    p_display_id: device.displayId,
    p_reason: parsed.data.reason,
  });

  // Covers both "no such session" and "belongs to another mirror", which a
  // caller must not be able to tell apart.
  if (error || !data) {
    return clientError('INVALID_REQUEST');
  }

  const ended = endedSessionSchema.safeParse(data);
  if (!ended.success) {
    return clientError('INTERNAL');
  }

  return NextResponse.json(
    {
      session_id: ended.data.session_id,
      status: ended.data.status,
      end_reason: ended.data.end_reason,
      already_ended: ended.data.already_ended,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
