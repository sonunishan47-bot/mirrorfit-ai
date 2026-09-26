/**
 * Kiosk client for commercial OVERLAY assets.
 *
 * Uses the enrolled device bearer. Never used on the phone catalog path.
 */

import type { GarmentOverlayResponse } from '@mirrorfit/validation';
import { garmentOverlayResponseSchema } from '@mirrorfit/validation';

export async function fetchGarmentOverlay(
  secret: string,
  garmentId: string,
  variantId: string,
  fetchFn: typeof fetch = fetch,
): Promise<GarmentOverlayResponse | null> {
  if (!secret || !garmentId || !variantId) return null;

  try {
    const params = new URLSearchParams({
      garment_id: garmentId,
      variant_id: variantId,
    });
    const response = await fetchFn(`/api/device/garment-overlay?${params.toString()}`, {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
    });
    if (!response.ok) return null;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return null;
    }
    const parsed = garmentOverlayResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
