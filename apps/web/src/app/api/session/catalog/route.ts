import { NextResponse } from 'next/server';

import { clientError } from '@/lib/api/errors';
import { loadShopCatalog } from '@/lib/catalog/load-shop-catalog';
import { parsePairingBearer, resolveClaimedSession } from '@/lib/session/pairing-auth';

export const dynamic = 'force-dynamic';

/**
 * Active garments for the shop behind a claimed pairing token.
 *
 * Tenancy is the session row. The phone never sends organization_id.
 * An empty list is a real empty catalog, not invented products.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = parsePairingBearer(request);
  if (!token) {
    return clientError('INVALID_TOKEN');
  }

  const session = await resolveClaimedSession(token);
  if (!session) {
    return clientError('INVALID_TOKEN');
  }

  const garments = await loadShopCatalog({
    organizationId: session.organizationId,
    shopId: session.shopId,
  });
  if (!garments) {
    return clientError('INTERNAL');
  }

  return NextResponse.json(
    { garments },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
