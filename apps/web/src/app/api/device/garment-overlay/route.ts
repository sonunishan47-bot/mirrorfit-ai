import { NextResponse } from 'next/server';

import { garmentOverlayQuerySchema, garmentOverlayResponseSchema } from '@mirrorfit/validation';

import { clientError } from '@/lib/api/errors';
import { resolveGarmentOverlayForShop } from '@/lib/catalog/resolve-garment-overlay';
import { authenticateDevice } from '@/lib/device/authenticate';

export const dynamic = 'force-dynamic';

/**
 * Enrolled mirror loads a commercial OVERLAY for the selected garment.
 *
 * Authenticate first. Garment and shop are resolved from the device
 * credential plus validated ids — never from a client-supplied tenancy
 * field. Storage paths stay off the phone catalog; only this device route
 * receives a short-lived signed URL.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const device = await authenticateDevice(request);
  if (!device) {
    return clientError('UNAUTHORIZED');
  }

  const url = new URL(request.url);
  const parsed = garmentOverlayQuerySchema.safeParse({
    garment_id: url.searchParams.get('garment_id'),
    variant_id: url.searchParams.get('variant_id'),
  });
  if (!parsed.success) {
    return clientError('INVALID_REQUEST');
  }

  const overlay = await resolveGarmentOverlayForShop({
    organizationId: device.organizationId,
    shopId: device.shopId,
    garmentId: parsed.data.garment_id,
    variantId: parsed.data.variant_id,
  });

  if (!overlay) {
    return clientError('INVALID_REQUEST');
  }

  const checked = garmentOverlayResponseSchema.safeParse(overlay);
  if (!checked.success) {
    return clientError('INTERNAL');
  }

  return NextResponse.json(checked.data, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
