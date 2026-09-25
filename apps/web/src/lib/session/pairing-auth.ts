import 'server-only';

import { pairingTokenSchema } from '@mirrorfit/validation';

import { sha256Hex } from '@/lib/crypto/secrets';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

export interface ClaimedSessionContext {
  readonly sessionId: string;
  readonly organizationId: string;
  readonly shopId: string;
  readonly status: string;
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

export function parsePairingBearer(request: Request): string | null {
  const token = readBearerToken(request);
  if (!token) return null;
  return pairingTokenSchema.safeParse(token).success ? token : null;
}

/**
 * Resolves a claimed live session from the pairing token hash.
 *
 * Tenancy comes from the session row. The phone never sends organization_id.
 */
export async function resolveClaimedSession(token: string): Promise<ClaimedSessionContext | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('sessions')
    .select('id, organization_id, shop_id, status, pairing_claimed_at')
    .eq('pairing_token_hash', sha256Hex(token))
    .in('status', ['PAIRED', 'ACTIVE'])
    .maybeSingle();

  if (error || !data || data.pairing_claimed_at === null) {
    return null;
  }

  return {
    sessionId: data.id,
    organizationId: data.organization_id,
    shopId: data.shop_id,
    status: data.status,
  };
}
