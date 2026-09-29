import { NextResponse } from 'next/server';

import { tryOnJobQueuedResponseSchema } from '@mirrorfit/validation';

import { clientError } from '@/lib/api/errors';
import { tryonJobRateLimiter } from '@/lib/api/rate-limit';
import { authenticateDevice } from '@/lib/device/authenticate';
import { readDeviceTryOnRequest } from '@/lib/tryon/tryon-job-request';
import { createDeviceTryOnJob } from '@/lib/tryon/tryon-job-service';

export const dynamic = 'force-dynamic';

/**
 * Enrolled mirror submits one consented JPEG for an optional realistic try-on.
 *
 * Device bearer first. Session, shop, and garment are resolved from that
 * credential — the body cannot name an organization or a shop. The response
 * is a job id and QUEUED. Storage paths stay on the server.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const device = await authenticateDevice(request);
  if (!device) {
    return clientError('UNAUTHORIZED');
  }

  const limited = tryonJobRateLimiter.check(device.displayId);
  if (!limited.ok) {
    return clientError('RATE_LIMITED', { retryAfterMs: limited.retryAfterMs });
  }

  const parsed = await readDeviceTryOnRequest(request);
  if (!parsed.ok) {
    return clientError('INVALID_REQUEST');
  }

  const created = await createDeviceTryOnJob({
    device,
    sessionId: parsed.data.sessionId,
    garmentId: parsed.data.garmentId,
    variantId: parsed.data.variantId,
    policyVersion: parsed.data.policyVersion,
    jpeg: parsed.data.jpeg,
  });
  if (!created.ok) {
    return clientError(created.error);
  }

  const body = tryOnJobQueuedResponseSchema.safeParse({
    job_id: created.job.jobId,
    status: created.job.status,
  });
  if (!body.success) {
    return clientError('INTERNAL');
  }

  return NextResponse.json(body.data, { headers: { 'Cache-Control': 'no-store' } });
}
