import { NextResponse } from 'next/server';

import { currentTryOnJobResponseSchema, uuidSchema } from '@mirrorfit/validation';

import { clientError } from '@/lib/api/errors';
import { authenticateDevice } from '@/lib/device/authenticate';
import { readCurrentTryOnJob } from '@/lib/tryon/tryon-job-service';

export const dynamic = 'force-dynamic';

/**
 * Latest try-on job for this mirror's session.
 *
 * A signed output URL is returned only while the session is ACTIVE and the
 * job succeeded. Input paths are never returned. A newer garment is a newer
 * row; the client must also ignore a mismatched garment id.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const device = await authenticateDevice(request);
  if (!device) {
    return clientError('UNAUTHORIZED');
  }

  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!uuidSchema.safeParse(sessionId).success || !sessionId) {
    return clientError('INVALID_REQUEST');
  }

  const current = await readCurrentTryOnJob({ device, sessionId });
  if (!current.ok) {
    return clientError(current.error);
  }

  const body = currentTryOnJobResponseSchema.safeParse({ job: current.job });
  if (!body.success) {
    return clientError('INTERNAL');
  }

  return NextResponse.json(body.data, { headers: { 'Cache-Control': 'no-store' } });
}
