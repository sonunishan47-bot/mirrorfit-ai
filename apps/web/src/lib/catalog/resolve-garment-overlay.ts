import 'server-only';

import type { OrganizationId, ShopId } from '@mirrorfit/types';
import type { GarmentOverlayResponse } from '@mirrorfit/validation';

import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

import {
  drawableOverlayFields,
  preferVariantOverlay,
} from './garment-overlay-helpers';

const SIGNED_URL_TTL_SECONDS = 120;

export interface ResolveGarmentOverlayInput {
  readonly organizationId: OrganizationId;
  readonly shopId: ShopId;
  readonly garmentId: string;
  readonly variantId: string;
}

/**
 * Resolves a commercial OVERLAY asset for an enrolled mirror's shop.
 *
 * Tenancy comes from the device credential, never from the client body.
 * Returns null when the garment is not in-shop or has no drawable overlay.
 */
export async function resolveGarmentOverlayForShop(
  input: ResolveGarmentOverlayInput,
): Promise<GarmentOverlayResponse | null> {
  const supabase = createSupabaseAdminClient();

  const { data: garment, error: garmentError } = await supabase
    .from('garments')
    .select('id')
    .eq('id', input.garmentId)
    .eq('shop_id', input.shopId)
    .eq('organization_id', input.organizationId)
    .eq('is_active', true)
    .maybeSingle();

  if (garmentError || !garment) {
    return null;
  }

  const { data: variant, error: variantError } = await supabase
    .from('garment_variants')
    .select('id')
    .eq('id', input.variantId)
    .eq('garment_id', input.garmentId)
    .eq('shop_id', input.shopId)
    .eq('organization_id', input.organizationId)
    .eq('is_active', true)
    .maybeSingle();

  if (variantError || !variant) {
    return null;
  }

  const asset = await loadPreferredOverlayAsset(input.garmentId, input.variantId, input.organizationId);
  if (!asset) return null;

  const fields = drawableOverlayFields(asset);
  if (!fields) return null;

  const { data: signed, error: signedError } = await supabase.storage
    .from(asset.storage_bucket)
    .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signedError || !signed?.signedUrl) {
    return null;
  }

  return {
    overlay_url: signed.signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
    width: fields.width,
    height: fields.height,
    mime_type: fields.mime,
    version: asset.version,
    content_hash: asset.content_hash,
    garment_id: input.garmentId,
    variant_id: asset.variant_id,
    anchor: fields.anchor,
  };
}

interface OverlayAssetRow {
  readonly variant_id: string | null;
  readonly version: number;
  readonly storage_bucket: string;
  readonly storage_path: string;
  readonly content_hash: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly mime_type: string | null;
  readonly metadata: unknown;
}

async function loadPreferredOverlayAsset(
  garmentId: string,
  variantId: string,
  organizationId: OrganizationId,
): Promise<OverlayAssetRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('garment_assets')
    .select(
      'variant_id, version, storage_bucket, storage_path, content_hash, width, height, mime_type, metadata',
    )
    .eq('garment_id', garmentId)
    .eq('organization_id', organizationId)
    .eq('kind', 'OVERLAY')
    .or(`variant_id.eq.${variantId},variant_id.is.null`)
    .order('version', { ascending: false });

  if (error || !data || data.length === 0) {
    return null;
  }

  return preferVariantOverlay(data as OverlayAssetRow[], variantId);
}
