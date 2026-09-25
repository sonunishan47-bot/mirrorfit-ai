import { NextResponse } from 'next/server';

import { clientError } from '@/lib/api/errors';
import { authenticateDevice } from '@/lib/device/authenticate';
import { readSelectedGarment } from '@/lib/session/session-garment';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

export const dynamic = 'force-dynamic';

/**
 * The live session on the calling display, if any.
 *
 * This is a read, not a new lifecycle operation. Create / claim / activate /
 * end stay on the Phase 3 routes and RPCs. The kiosk needs this because
 * claim is performed by the phone: without a status read the glass cannot
 * see WAITING become PAIRED and would have to invent that transition.
 *
 * Display comes from the credential. The token hash is not selected.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const device = await authenticateDevice(request);
  if (!device) {
    return clientError('UNAUTHORIZED');
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('sessions')
    .select('id, status, pairing_expires_at')
    .eq('display_id', device.displayId)
    .in('status', ['WAITING', 'PAIRED', 'ACTIVE'])
    .maybeSingle();

  if (error) {
    return clientError('INTERNAL');
  }

  if (!data) {
    return NextResponse.json({ session: null }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const selected = await readSelectedGarment(data.id);

  return NextResponse.json(
    {
      session: {
        session_id: data.id,
        status: data.status,
        pairing_expires_at: data.pairing_expires_at,
        selected_garment: selected,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
