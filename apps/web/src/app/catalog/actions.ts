'use server';

import { revalidatePath } from 'next/cache';

import { MANAGER_ROLE_RANK } from '@mirrorfit/types';
import { garmentCreateSchema, uuidSchema } from '@mirrorfit/validation';

import { recordStaffAction } from '@/lib/audit';
import { requireStaffRank } from '@/lib/auth/staff';
import { createSupabaseServerClient } from '@/lib/supabase/server-client';

export interface CatalogActionResult {
  readonly ok: boolean;
  readonly message?: string;
}

function skuFromName(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length > 0 ? base : 'GARMENT';
}

async function shopInScope(shopId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('shops').select('id').eq('id', shopId).maybeSingle();
  return data !== null;
}

export async function createGarment(
  _previous: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const staff = await requireStaffRank(MANAGER_ROLE_RANK);
  const parsed = garmentCreateSchema.safeParse({
    shop_id: formData.get('shop_id'),
    name: formData.get('name'),
    sku: formData.get('sku') ?? '',
    category: formData.get('category'),
    color_name: formData.get('color_name'),
    color_hex: formData.get('color_hex'),
    price_minor: formData.get('price_minor') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, message: 'Check the name, category, colour, and price.' };
  }
  if (!(await shopInScope(parsed.data.shop_id))) {
    return { ok: false, message: 'That shop is not available to you.' };
  }

  const sku = parsed.data.sku.length > 0 ? parsed.data.sku : skuFromName(parsed.data.name);
  const price = parsed.data.price_minor;
  const supabase = await createSupabaseServerClient();
  const { data: garment, error } = await supabase
    .from('garments')
    .insert({
      organization_id: staff.organizationId,
      shop_id: parsed.data.shop_id,
      sku,
      name: parsed.data.name,
      category: parsed.data.category,
      brand: null,
      price_minor: price,
      currency_code: price === null ? null : 'SAR',
      is_active: true,
    })
    .select('id')
    .single();
  if (error || !garment) {
    return {
      ok: false,
      message: 'Could not add that garment. The SKU may already exist in this shop.',
    };
  }

  const colorSku = `${sku}-${
    parsed.data.color_name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 12) || 'COLOR'
  }`.slice(0, 64);
  const { data: variant, error: variantError } = await supabase
    .from('garment_variants')
    .insert({
      organization_id: staff.organizationId,
      shop_id: parsed.data.shop_id,
      garment_id: garment.id,
      color_name: parsed.data.color_name,
      color_hex: parsed.data.color_hex,
      sku: colorSku,
      is_active: true,
    })
    .select('id')
    .single();
  if (variantError || !variant) {
    await supabase.from('garments').delete().eq('id', garment.id);
    return { ok: false, message: 'The garment colour could not be saved.' };
  }

  const { data: chart, error: chartError } = await supabase
    .from('size_charts')
    .insert({
      organization_id: staff.organizationId,
      shop_id: parsed.data.shop_id,
      garment_id: garment.id,
      name: `${parsed.data.name} sizes`.slice(0, 200),
    })
    .select('id')
    .single();
  if (chartError || !chart) {
    await supabase.from('garments').delete().eq('id', garment.id);
    return { ok: false, message: 'The size chart could not be saved.' };
  }

  const { error: sizeError } = await supabase.from('size_measurements').insert(
    (['S', 'M', 'L'] as const).map((size_label) => ({
      organization_id: staff.organizationId,
      shop_id: parsed.data.shop_id,
      size_chart_id: chart.id,
      size_label,
    })),
  );
  if (sizeError) {
    await supabase.from('garments').delete().eq('id', garment.id);
    return { ok: false, message: 'The sizes could not be saved.' };
  }

  await recordStaffAction({
    organizationId: staff.organizationId,
    staffId: staff.staffId,
    action: 'garment.create',
    entityType: 'garment',
    entityId: garment.id,
    metadata: {
      sku,
      category: parsed.data.category,
      variant_id: variant.id,
    },
  });
  revalidatePath('/catalog');
  return { ok: true, message: `${parsed.data.name} is in the shop catalog.` };
}

export async function setGarmentActive(
  _previous: CatalogActionResult,
  formData: FormData,
): Promise<CatalogActionResult> {
  const staff = await requireStaffRank(MANAGER_ROLE_RANK);
  const id = uuidSchema.safeParse(formData.get('garment_id'));
  const active = formData.get('is_active') === 'true';
  if (!id.success) return { ok: false, message: 'That garment was not found.' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('garments')
    .update({ is_active: active })
    .eq('id', id.data)
    .select('id')
    .maybeSingle();
  if (error || !data) return { ok: false, message: 'Could not update that garment.' };

  await recordStaffAction({
    organizationId: staff.organizationId,
    staffId: staff.staffId,
    action: active ? 'garment.activate' : 'garment.deactivate',
    entityType: 'garment',
    entityId: data.id,
  });
  revalidatePath('/catalog');
  return {
    ok: true,
    message: active ? 'Garment is visible again.' : 'Garment hidden from the catalog.',
  };
}
