import 'server-only';

import type { SizeLabel } from '@mirrorfit/types';
import { selectedGarmentSchema } from '@mirrorfit/validation';

import { isTestFixtureCatalogName } from '@/lib/catalog/shop-catalog';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

import type { ClaimedSessionContext } from './pairing-auth';
import { sessionCanMutateGarment } from './session-garment-policy';

export { sessionCanMutateGarment } from './session-garment-policy';

export interface SelectedGarment {
  readonly garment_id: string;
  readonly variant_id: string;
  readonly category?: string;
  readonly is_test_fixture?: boolean;
  readonly color_name?: string;
  readonly size_label?: SizeLabel;
}

export async function readSelectedGarment(sessionId: string): Promise<SelectedGarment | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('session_events')
    .select('type, payload, organization_id, shop_id')
    .eq('session_id', sessionId)
    .in('type', ['GARMENT_SELECTED', 'GARMENT_CLEARED'])
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  if (data.type === 'GARMENT_CLEARED') return null;
  const parsed = selectedGarmentSchema.safeParse(data.payload);
  if (!parsed.success) return null;

  const garment = await supabase
    .from('garments')
    .select('name, category, is_active')
    .eq('id', parsed.data.garment_id)
    .eq('organization_id', data.organization_id)
    .eq('shop_id', data.shop_id)
    .eq('is_active', true)
    .maybeSingle();

  if (garment.error || !garment.data) return null;

  return {
    garment_id: parsed.data.garment_id,
    variant_id: parsed.data.variant_id,
    category: garment.data.category,
    is_test_fixture: isTestFixtureCatalogName(garment.data.name),
    ...(parsed.data.color_name ? { color_name: parsed.data.color_name } : {}),
    ...(parsed.data.size_label ? { size_label: parsed.data.size_label } : {}),
  };
}

export async function writeSelectedGarment(
  session: ClaimedSessionContext,
  selection: SelectedGarment | null,
): Promise<boolean> {
  if (!sessionCanMutateGarment(session.status)) return false;
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from('session_events').insert({
    organization_id: session.organizationId,
    shop_id: session.shopId,
    session_id: session.sessionId,
    message_id: crypto.randomUUID(),
    type: selection ? 'GARMENT_SELECTED' : 'GARMENT_CLEARED',
    actor_kind: 'CUSTOMER',
    protocol_version: 1,
    payload: selection ?? {},
    occurred_at: new Date().toISOString(),
  });
  return !error;
}

export async function resolveShopGarment(
  session: ClaimedSessionContext,
  selection: SelectedGarment,
): Promise<SelectedGarment | null> {
  const supabase = createSupabaseAdminClient();
  const variant = await supabase
    .from('garment_variants')
    .select('id, garment_id, organization_id, shop_id, is_active, color_name')
    .eq('id', selection.variant_id)
    .eq('garment_id', selection.garment_id)
    .eq('organization_id', session.organizationId)
    .eq('shop_id', session.shopId)
    .eq('is_active', true)
    .maybeSingle();

  if (variant.error || variant.data === null) return null;

  const garment = await supabase
    .from('garments')
    .select('name, category, is_active')
    .eq('id', selection.garment_id)
    .eq('organization_id', session.organizationId)
    .eq('shop_id', session.shopId)
    .eq('is_active', true)
    .maybeSingle();

  if (garment.error || !garment.data) return null;

  return {
    garment_id: selection.garment_id,
    variant_id: selection.variant_id,
    category: garment.data.category,
    is_test_fixture: isTestFixtureCatalogName(garment.data.name),
    color_name: variant.data.color_name,
    ...(selection.size_label ? { size_label: selection.size_label } : {}),
  };
}

export async function garmentBelongsToSessionShop(
  session: ClaimedSessionContext,
  selection: SelectedGarment,
): Promise<boolean> {
  return (await resolveShopGarment(session, selection)) !== null;
}
