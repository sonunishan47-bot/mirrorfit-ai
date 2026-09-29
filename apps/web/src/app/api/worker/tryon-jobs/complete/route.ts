import { NextResponse } from 'next/server';

import { clientError } from '@/lib/api/errors';
import { clientIpFromRequest, workerJobRateLimiter } from '@/lib/api/rate-limit';
import { readWorkerCompleteRequest } from '@/lib/tryon/tryon-job-request';
import { completeTryOnJob } from '@/lib/tryon/tryon-job-service';
import { authorizeWorkerRequest } from '@/lib/tryon/worker-auth';

export const dynamic = 'force-dynamic';

/**
 * Worker finishes the job it moved to RUNNING.
 *
 * SUCCEEDED requires a real JPEG from the model process. FAILED requires an
 * error code. A stale completion (the row is no longer RUNNING) is rejected
 * so an older garment cannot overwrite a newer selection.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!authorizeWorkerRequest(request)) {
    return clientError('UNAUTHORIZED');
  }

  const limited = workerJobRateLimiter.check(clientIpFromRequest(request));
  if (!limited.ok) {
    return clientError('RATE_LIMITED', { retryAfterMs: limited.retryAfterMs });
  }

  const parsed = await readWorkerCompleteRequest(request);
  if (!parsed.ok) {
    return clientError('INVALID_REQUEST');
  }

  const completed = await completeTryOnJob({
    jobId: parsed.jobId,
    status: parsed.status,
    errorCode: parsed.errorCode,
    jpeg: parsed.jpeg,
  });
  if (!completed.ok) {
    return clientError(completed.error);
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
