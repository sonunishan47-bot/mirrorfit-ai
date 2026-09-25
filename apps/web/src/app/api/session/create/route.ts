import { NextResponse } from 'next/server';

import {
  createdSessionSchema,
  parseJsonBody,
  sessionCreateRequestSchema,
} from '@mirrorfit/validation';

import { clientError } from '@/lib/api/errors';
import { generatePairingToken, sha256Hex } from '@/lib/crypto/secrets';
import { authenticateDevice } from '@/lib/device/authenticate';
import { buildPairingUrl, DEFAULT_PAIRING_TTL_SECONDS } from '@/lib/session/pairing';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

export const dynamic = 'force-dynamic';

/**
 * A mirror opens a fitting session and gets a QR code to display.
 *
 * Authenticate before parsing, as in the heartbeat route: a malformed body
 * from an unauthenticated caller should cost a hash lookup and nothing more.
 *
 * The display is taken from the credential, never from the payload, so a
 * mirror cannot open a session on another mirror's screen. Organization and
 * shop are resolved inside the database function from that display, so no
 * tenancy identifier crosses the wire at all.
 *
 * Creating a session also resets the mirror: the database function ends
 * whatever session was still live on this display before inserting the new
 * one, and a partial unique index makes it impossible for both to exist. A
 * customer who walks away cannot leave their selections on screen for the
 * next person.
 *
 * The token is returned exactly once, inside the URL the QR code encodes.
 * Only its hash reaches the database, so reading the sessions table later
 * reveals nothing that can be used to join a session.
 *
 * Not audited. A mirror opens a session every time someone walks up to it,
 * and writing an audit row per session would bury the events that matter.
 * The sessions table is itself the record.
 *
 * TODO (Phase 15): rate limit by credential. A valid but misbehaving mirror
 * can currently churn sessions as fast as it can call this.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const device = await authenticateDevice(request);
  if (!device) {
    return clientError('UNAUTHORIZED');
  }

  const parsed = await parseJsonBody(sessionCreateRequestSchema, request);
  if (!parsed.ok) {
    return clientError('INVALID_REQUEST');
  }

  const token = generatePairingToken();
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc('create_display_session', {
    p_display_id: device.displayId,
    p_token_hash: sha256Hex(token),
    p_ttl_seconds: parsed.data.ttl_seconds ?? DEFAULT_PAIRING_TTL_SECONDS,
    // Omitted rather than passed as null, so the database falls back to the
    // shop's configured default instead of being told "no locale".
    ...(parsed.data.locale ? { p_locale: parsed.data.locale } : {}),
  });

  if (error || !data) {
    return clientError('INTERNAL');
  }

  const session = createdSessionSchema.safeParse(data);
  if (!session.success) {
    return clientError('INTERNAL');
  }

  return NextResponse.json(
    {
      session_id: session.data.session_id,
      status: session.data.status,
      locale: session.data.locale,
      pairing_url: buildPairingUrl(request, token),
      pairing_expires_at: session.data.pairing_expires_at,
    },
    // Carries a live pairing token. Nothing between here and the mirror may
    // keep a copy.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
