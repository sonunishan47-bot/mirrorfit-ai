import { describe, expect, it } from 'vitest';

import {
  claimedSessionSchema,
  createdSessionSchema,
  deviceSessionEndReasonSchema,
  endedSessionSchema,
  pairingTokenSchema,
  pairingTtlSecondsSchema,
  sessionClaimRequestSchema,
  sessionCreateRequestSchema,
  sessionEndRequestSchema,
} from './sessions';

const TOKEN = 'a'.repeat(43);
const UUID = '11111111-1111-4111-8111-111111111111';

describe('pairing token', () => {
  it('accepts a 43 character base64url token', () => {
    expect(pairingTokenSchema.safeParse(TOKEN).success).toBe(true);
    expect(pairingTokenSchema.safeParse('aA0_-'.repeat(8) + 'aba').success).toBe(true);
  });

  it('rejects a short token', () => {
    expect(pairingTokenSchema.safeParse('a'.repeat(42)).success).toBe(false);
  });

  it('rejects a long token', () => {
    expect(pairingTokenSchema.safeParse('a'.repeat(44)).success).toBe(false);
  });

  it('rejects characters that base64url never produces', () => {
    // '+' and '/' are standard base64; a token containing them did not come
    // from generatePairingToken and should not be hashed and looked up.
    expect(pairingTokenSchema.safeParse('a'.repeat(42) + '+').success).toBe(false);
    expect(pairingTokenSchema.safeParse('a'.repeat(42) + '/').success).toBe(false);
    expect(pairingTokenSchema.safeParse('a'.repeat(42) + '=').success).toBe(false);
  });
});

describe('pairing ttl', () => {
  it('matches the bounds the database enforces', () => {
    expect(pairingTtlSecondsSchema.safeParse(30).success).toBe(true);
    expect(pairingTtlSecondsSchema.safeParse(3600).success).toBe(true);
    expect(pairingTtlSecondsSchema.safeParse(29).success).toBe(false);
    expect(pairingTtlSecondsSchema.safeParse(3601).success).toBe(false);
  });

  it('rejects a fractional ttl', () => {
    expect(pairingTtlSecondsSchema.safeParse(60.5).success).toBe(false);
  });
});

describe('session create request', () => {
  it('accepts an empty body and lets the server choose defaults', () => {
    expect(sessionCreateRequestSchema.safeParse({}).success).toBe(true);
  });

  it('rejects an unsupported locale', () => {
    expect(sessionCreateRequestSchema.safeParse({ locale: 'fr' }).success).toBe(false);
  });

  it('accepts a supported locale', () => {
    const parsed = sessionCreateRequestSchema.safeParse({ locale: 'ar', ttl_seconds: 300 });
    expect(parsed.success).toBe(true);
  });
});

describe('session claim request', () => {
  it('requires a well formed token', () => {
    expect(sessionClaimRequestSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(sessionClaimRequestSchema.safeParse({ token: 'nope' }).success).toBe(false);
    expect(sessionClaimRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('session end request', () => {
  it('accepts the reasons a device can honestly report', () => {
    for (const reason of ['CUSTOMER_ENDED', 'DISCONNECTED', 'ERROR']) {
      expect(sessionEndRequestSchema.safeParse({ session_id: UUID, reason }).success).toBe(true);
    }
  });

  /**
   * These two are real values of the database enum, so the guard has to be
   * explicit. TIMEOUT belongs to the expiry sweep and STAFF_RESET to a staff
   * action; a device claiming either would be writing a false history of its
   * own sessions.
   */
  it('refuses reasons that are not a device decision', () => {
    expect(deviceSessionEndReasonSchema.safeParse('TIMEOUT').success).toBe(false);
    expect(deviceSessionEndReasonSchema.safeParse('STAFF_RESET').success).toBe(false);
  });

  it('requires a session id', () => {
    expect(sessionEndRequestSchema.safeParse({ reason: 'CUSTOMER_ENDED' }).success).toBe(false);
  });
});

describe('database results are parsed, not trusted', () => {
  it('accepts the shape create_display_session returns', () => {
    const parsed = createdSessionSchema.safeParse({
      session_id: UUID,
      organization_id: UUID,
      shop_id: UUID,
      display_id: UUID,
      status: 'WAITING',
      locale: 'en',
      pairing_expires_at: '2026-01-01T00:00:00+00:00',
      superseded_session_id: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('keeps superseded_session_id nullable, because usually nothing was superseded', () => {
    const base = {
      session_id: UUID,
      organization_id: UUID,
      shop_id: UUID,
      display_id: UUID,
      status: 'WAITING',
      locale: 'en',
      pairing_expires_at: '2026-01-01T00:00:00+00:00',
    };
    expect(createdSessionSchema.safeParse({ ...base, superseded_session_id: UUID }).success).toBe(
      true,
    );
    // Absent is not the same as null; the function always returns the key.
    expect(createdSessionSchema.safeParse(base).success).toBe(false);
  });

  it('rejects a status outside the state machine', () => {
    const parsed = claimedSessionSchema.safeParse({
      session_id: UUID,
      organization_id: UUID,
      shop_id: UUID,
      display_id: UUID,
      status: 'CONNECTED',
      locale: 'en',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts the full end reason enum on the way back out', () => {
    // The device may only *request* three reasons, but the database can
    // report any of them, including a TIMEOUT written by the expiry sweep.
    const parsed = endedSessionSchema.safeParse({
      session_id: UUID,
      status: 'EXPIRED',
      end_reason: 'TIMEOUT',
      already_ended: true,
    });
    expect(parsed.success).toBe(true);
  });
});
