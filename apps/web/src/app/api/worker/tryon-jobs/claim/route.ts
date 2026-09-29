import { NextResponse } from 'next/server';

import { clientError } from '@/lib/api/errors';
import { clientIpFromRequest, workerJobRateLimiter } from '@/lib/api/rate-limit';
import { claimNextTryOnJob } from '@/lib/tryon/tryon-job-service';
import { authorizeWorkerRequest } from '@/lib/tryon/worker-auth';

export const dynamic = 'force-dynamic';

/**
 * Worker claims the oldest QUEUED still.
 *
 * Authenticated with WORKER_SECRET, not a device secret and not a staff
 * cookie. The browser never calls this. The response carries short-lived
 * signed URLs for the person still and, when one exists, the AI_REFERENCE
 * garment. It does not carry a fabricated result.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!authorizeWorkerRequest(request)) {
    return clientError('UNAUTHORIZED');
  }

  const limited = workerJobRateLimiter.check(clientIpFromRequest(request));
  if (!limited.ok) {
    return clientError('RATE_LIMITED', { retryAfterMs: limited.retryAfterMs });
  }

  const claimed = await claimNextTryOnJob();
  if (!claimed.ok) {
    return clientError(claimed.error);
  }

  return NextResponse.json({ job: claimed.job }, { headers: { 'Cache-Control': 'no-store' } });
}
