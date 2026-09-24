import 'server-only';

import type { DisplayId, OrganizationId, ShopId } from '@mirrorfit/types';
import type { DeviceCredentialId } from '@mirrorfit/types';

import { sha256Hex } from '@/lib/crypto/secrets';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

/**
 * The identity a mirror proves by presenting its secret.
 *
 * Every field here is read from the database row the secret resolved to.
 * None of it is taken from the request, which is what makes a mirror unable
 * to act on another shop's behalf by editing a payload.
 */
export interface DeviceContext {
  readonly credentialId: DeviceCredentialId;
  readonly displayId: DisplayId;
  readonly organizationId: OrganizationId;
  readonly shopId: ShopId;
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) {
    return null;
  }

  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') {
    return null;
  }

  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolves a mirror from its bearer secret, or `null`.
 *
 * The lookup is by hash alone. The request never names a display, so there is
 * no client-supplied `display_id` to validate and no way to confuse the
 * server into serving one mirror's context to another.
 *
 * Uses the admin client because a mirror is not a database user and no RLS
 * policy could describe it. The privilege is confined to this function and
 * the narrow row it returns.
 */
export async function authenticateDevice(request: Request): Promise<DeviceContext | null> {
  const secret = extractBearer(request);
  if (!secret) {
    return null;
  }

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from('device_credentials')
    .select('id, display_id, organization_id, shop_id, revoked_at, expires_at')
    .eq('secret_hash', sha256Hex(secret))
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  if (data.revoked_at !== null) {
    return null;
  }

  if (data.expires_at !== null && new Date(data.expires_at).getTime() <= Date.now()) {
    return null;
  }

  // Best-effort. A mirror whose "last used" timestamp is stale is a reporting
  // inaccuracy; refusing its heartbeat over one would be an outage.
  await supabase
    .from('device_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return {
    credentialId: data.id as DeviceCredentialId,
    displayId: data.display_id as DisplayId,
    organizationId: data.organization_id as OrganizationId,
    shopId: data.shop_id as ShopId,
  };
}
