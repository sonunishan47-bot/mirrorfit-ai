import { z } from 'zod';

import { localeSchema, sessionEndReasonSchema, sessionStatusSchema } from './enums';
import { isoTimestampSchema, uuidSchema } from './primitives';

/**
 * A pairing token as it travels in the QR code.
 *
 * 32 random bytes rendered base64url, so 43 characters with no padding. The
 * length is pinned rather than left open because this is the only credential
 * a customer's phone presents: a short token here would be a guessable one,
 * and there is no second factor behind it.
 */
export const pairingTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'is not a pairing token');

/**
 * How long a QR code stays scannable.
 *
 * The floor keeps a code alive long enough for someone to actually walk up
 * and scan it; the ceiling stops a mirror from leaving an hour-long
 * credential on screen. The database enforces the same bounds, because a
 * check that only exists in the application is a check a future caller
 * skips.
 */
export const pairingTtlSecondsSchema = z.int().min(30).max(3600);

export const sessionCreateRequestSchema = z.object({
  locale: localeSchema.nullish(),
  ttl_seconds: pairingTtlSecondsSchema.nullish(),
});

export type SessionCreateRequest = z.infer<typeof sessionCreateRequestSchema>;

export const sessionClaimRequestSchema = z.object({
  token: pairingTokenSchema,
});

export type SessionClaimRequest = z.infer<typeof sessionClaimRequestSchema>;

/**
 * Reasons a device may give for ending a session.
 *
 * Narrower than the full enum on purpose. `TIMEOUT` belongs to the expiry
 * sweep and `STAFF_RESET` to a staff action, so allowing a device to claim
 * either would let it write a misleading history of its own sessions.
 */
export const deviceSessionEndReasonSchema = z.enum(['CUSTOMER_ENDED', 'DISCONNECTED', 'ERROR']);

export const sessionEndRequestSchema = z.object({
  session_id: uuidSchema,
  reason: deviceSessionEndReasonSchema,
});

export type SessionEndRequest = z.infer<typeof sessionEndRequestSchema>;

export const sessionActivateRequestSchema = z.object({
  session_id: uuidSchema,
});

/** Result of `public.create_display_session`, parsed rather than cast. */
export const createdSessionSchema = z.object({
  session_id: uuidSchema,
  organization_id: uuidSchema,
  shop_id: uuidSchema,
  display_id: uuidSchema,
  status: sessionStatusSchema,
  locale: localeSchema,
  pairing_expires_at: isoTimestampSchema,
  // Null when the mirror had no session to reclaim.
  superseded_session_id: uuidSchema.nullable(),
});

/** Result of `public.claim_session_pairing_token`, parsed rather than cast. */
export const claimedSessionSchema = z.object({
  session_id: uuidSchema,
  organization_id: uuidSchema,
  shop_id: uuidSchema,
  display_id: uuidSchema,
  status: sessionStatusSchema,
  locale: localeSchema,
});

/** Result of `public.end_display_session`. */
export const endedSessionSchema = z.object({
  session_id: uuidSchema,
  status: sessionStatusSchema,
  end_reason: sessionEndReasonSchema,
  already_ended: z.boolean(),
});

/** Result of `public.activate_display_session`. */
export const activatedSessionSchema = z.object({
  session_id: uuidSchema,
  status: sessionStatusSchema,
});
