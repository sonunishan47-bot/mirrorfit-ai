import { NextResponse } from 'next/server';

import { clientError } from '@/lib/api/errors';
import { parsePairingBearer, resolveClaimedSession } from '@/lib/session/pairing-auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

export const dynamic = 'force-dynamic';

/**
 * Job status for the phone. Paths, signed URLs, and images are not selected.
 * The realistic result stays on the mirror.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = parsePairingBearer(request);
  if (!token) return clientError('INVALID_TOKEN');
  const session = await resolveClaimedSession(token);
  if (!session) return clientError('INVALID_TOKEN');

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('tryon_jobs')
    .select('status, error_code')
    .eq('session_id', session.sessionId)
    .order('queued_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return clientError('INTERNAL');

  return NextResponse.json(
    { status: data?.status ?? null, error_code: data?.error_code ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
