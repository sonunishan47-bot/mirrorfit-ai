import { NextResponse } from 'next/server';

import {
  activatedSessionSchema,
  parseJsonBody,
  sessionActivateRequestSchema,
} from '@mirrorfit/validation';

import { clientError } from '@/lib/api/errors';
import { authenticateDevice } from '@/lib/device/authenticate';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

export const dynamic = 'force-dynamic';

/**
 * A mirror confirms it is talking to the paired phone.
 *
 * PAIRED and ACTIVE are kept distinct so the mirror can show "connecting"
 * rather than a half-live fitting screen: the phone has claimed the session,
 * but until the realtime link is up neither side can act on the other's
 * messages.
 *
 * As with ending, the display comes from the credential and the database
 * matches on it, so a mirror cannot activate another mirror's session.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const device = await authenticateDevice(request);
  if (!device) {
    return clientError('UNAUTHORIZED');
  }

  const parsed = await parseJsonBody(sessionActivateRequestSchema, request);
  if (!parsed.ok) {
    return clientError('INVALID_REQUEST');
  }

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc('activate_display_session', {
    p_session_id: parsed.data.session_id,
    p_display_id: device.displayId,
  });

  if (error || !data) {
    return clientError('INVALID_REQUEST');
  }

  const activated = activatedSessionSchema.safeParse(data);
  if (!activated.success) {
    return clientError('INTERNAL');
  }

  return NextResponse.json(
    {
      session_id: activated.data.session_id,
      status: activated.data.status,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
