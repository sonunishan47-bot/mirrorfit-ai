import { NextResponse } from 'next/server';

import { deviceHeartbeatRequestSchema, parseJsonBody } from '@mirrorfit/validation';

import { clientError } from '@/lib/api/errors';
import { authenticateDevice } from '@/lib/device/authenticate';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';
import { sweepTryOnAssets } from '@/lib/tryon/tryon-job-service';

export const dynamic = 'force-dynamic';

/**
 * A mirror reports that it is alive and how it is doing.
 *
 * Note the order: authenticate, then parse. A malformed body from an
 * unauthenticated caller should cost a hash lookup and nothing more, and it
 * should not be able to tell the difference between "your body was wrong"
 * and "your credential was wrong" by comparing which error comes back first.
 *
 * Every metric is passed through exactly as received, including null. A
 * mirror that did not measure its frame rate reports null and null is
 * stored. Coercing that to zero here would make an unmeasured pipeline
 * indistinguishable from a stalled one in every dashboard and percentile
 * built on this table later.
 *
 * Heartbeats are not audited. They are routine telemetry at a fixed
 * interval, and writing an audit row for each would bury the events that
 * matter under millions that do not.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const device = await authenticateDevice(request);
  if (!device) {
    return clientError('UNAUTHORIZED');
  }

  const parsed = await parseJsonBody(deviceHeartbeatRequestSchema, request);
  if (!parsed.ok) {
    return clientError('INVALID_REQUEST');
  }

  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.rpc('record_device_heartbeat', {
    // The display comes from the credential, never from the payload.
    p_display_id: device.displayId,
    p_payload: {
      app_version: parsed.data.app_version ?? null,
      camera_ok: parsed.data.camera_ok ?? null,
      render_fps: parsed.data.render_fps ?? null,
      processing_fps: parsed.data.processing_fps ?? null,
      metrics: parsed.data.metrics ?? null,
    },
  });

  if (error) {
    return clientError('INTERNAL');
  }

  await sweepTryOnAssets();

  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
