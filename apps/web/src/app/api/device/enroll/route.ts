import { NextResponse } from 'next/server';

import type { DisplayId, OrganizationId } from '@mirrorfit/types';
import {
  claimedEnrollmentSchema,
  deviceEnrollRequestSchema,
  parseJsonBody,
} from '@mirrorfit/validation';

import { recordDeviceAction } from '@/lib/audit';
import { generateDeviceSecret, sha256Hex } from '@/lib/crypto/secrets';
import { deviceError } from '@/lib/device/responses';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

export const dynamic = 'force-dynamic';

/**
 * A mirror trades an enrollment code for its device secret.
 *
 * This is the one unauthenticated write in the device API, because it is how
 * a mirror gets something to authenticate with. What keeps it safe is the
 * code: 60 bits, single use, short-lived, and superseded the moment another
 * is issued for the same display.
 *
 * The secret is generated here and only its hash is sent to the database, so
 * the plaintext exists in this process and in this response and nowhere else
 * — not in a log, not in a later response, not in a column. A mirror that
 * loses it must be re-enrolled, which is the correct trade.
 *
 * TODO (Phase 15): add distributed rate limiting by source address. The
 * entropy and lifetime of a code defeat guessing, but they do nothing about
 * someone making this endpoint expensive to serve.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await parseJsonBody(deviceEnrollRequestSchema, request);
  if (!parsed.ok) {
    return deviceError('INVALID_REQUEST');
  }

  const secret = generateDeviceSecret();
  const supabase = createSupabaseAdminClient();

  // One transactional call. It claims the code, mints the credential, marks
  // the display online and opens the installation record together, so a
  // failure part-way through leaves no credential behind.
  const { data, error } = await supabase.rpc('claim_device_enrollment_code', {
    p_code_hash: sha256Hex(parsed.data.code),
    p_secret_hash: sha256Hex(secret),
    p_payload: {
      app_version: parsed.data.app_version ?? null,
      screen_width: parsed.data.screen_width ?? null,
      screen_height: parsed.data.screen_height ?? null,
      hardware_info: parsed.data.hardware_info ?? null,
    },
  });

  // Every rejection reason collapses to one code. Telling a caller that a
  // code was real but expired confirms the guess was once correct.
  if (error || !data) {
    return deviceError('INVALID_CODE');
  }

  const claim = claimedEnrollmentSchema.safeParse(data);
  if (!claim.success) {
    return deviceError('INTERNAL');
  }

  await recordDeviceAction({
    organizationId: claim.data.organization_id as OrganizationId,
    displayId: claim.data.display_id as DisplayId,
    action: 'DEVICE_ENROLLED',
    entityType: 'device_credential',
    entityId: claim.data.credential_id,
    // Names the credential, never the secret or its hash.
    metadata: { display_slug: claim.data.display_slug },
  });

  return NextResponse.json(
    {
      device_secret: secret,
      display: {
        id: claim.data.display_id,
        name: claim.data.display_name,
        slug: claim.data.display_slug,
        shop_id: claim.data.shop_id,
      },
    },
    // The one response in the system carrying a live credential. Make sure
    // nothing between here and the mirror keeps a copy.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
