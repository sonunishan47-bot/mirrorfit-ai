import { NextResponse } from 'next/server';

import { uuidSchema } from '@mirrorfit/validation';

import { clientError } from '@/lib/api/errors';
import { parsePairingBearer, resolveClaimedSession } from '@/lib/session/pairing-auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

export const dynamic = 'force-dynamic';

function centimetres(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Garment size chart for the phone. Measurements of the customer are not accepted
 * and are not stored. An empty list means this garment has no chart.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = parsePairingBearer(request);
  if (!token) return clientError('INVALID_TOKEN');
  const session = await resolveClaimedSession(token);
  if (!session) return clientError('INVALID_TOKEN');

  const garmentId = new URL(request.url).searchParams.get('garment_id');
  if (!garmentId || !uuidSchema.safeParse(garmentId).success) {
    return clientError('INVALID_REQUEST');
  }

  const supabase = createSupabaseAdminClient();
  const garment = await supabase
    .from('garments')
    .select('id')
    .eq('id', garmentId)
    .eq('shop_id', session.shopId)
    .eq('organization_id', session.organizationId)
    .maybeSingle();
  if (garment.error || !garment.data) return clientError('INVALID_REQUEST');

  const chart = await supabase
    .from('size_charts')
    .select('id')
    .eq('garment_id', garmentId)
    .eq('shop_id', session.shopId)
    .maybeSingle();
  if (chart.error) return clientError('INTERNAL');
  if (!chart.data) {
    return NextResponse.json({ sizes: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const rows = await supabase
    .from('size_measurements')
    .select('size_label, chest_cm, waist_cm, hip_cm, length_cm, sleeve_cm, inseam_cm')
    .eq('size_chart_id', chart.data.id)
    .eq('shop_id', session.shopId);
  if (rows.error) return clientError('INTERNAL');

  return NextResponse.json(
    {
      sizes: (rows.data ?? []).map((row) => ({
        label: row.size_label,
        chest_cm: centimetres(row.chest_cm),
        waist_cm: centimetres(row.waist_cm),
        hip_cm: centimetres(row.hip_cm),
        length_cm: centimetres(row.length_cm),
        sleeve_cm: centimetres(row.sleeve_cm),
        inseam_cm: centimetres(row.inseam_cm),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
