import { normalizeEnrollmentCode } from '@mirrorfit/types';
import { z } from 'zod';

import { semverSchema, shortTextSchema, slugSchema, uuidSchema } from './primitives';

/**
 * An enrollment code as typed by a human.
 *
 * Normalises before validating, so the schema's output is always canonical
 * and every caller downstream is comparing the same thing. A route that
 * hashed the raw input instead would reject a correct code typed in lower
 * case.
 */
export const enrollmentCodeSchema = z
  .string()
  .max(32, 'is not an enrollment code')
  .transform((raw, ctx) => {
    const normalized = normalizeEnrollmentCode(raw);
    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message: 'is not a valid enrollment code' });
      return z.NEVER;
    }
    return normalized;
  });

/**
 * Free-form facts a mirror reports about its own hardware.
 *
 * Bounded in breadth and depth on purpose. This lands in a jsonb column and
 * is rendered in the dashboard, so an unbounded blob from a device is both a
 * storage and a rendering hazard.
 */
export const hardwareInfoSchema = z.record(
  z.string().max(64),
  z.union([z.string().max(200), z.number().finite(), z.boolean()]),
);

const screenDimensionSchema = z.int().positive().max(16384);

export const deviceEnrollRequestSchema = z.object({
  code: enrollmentCodeSchema,
  app_version: semverSchema.nullish(),
  screen_width: screenDimensionSchema.nullish(),
  screen_height: screenDimensionSchema.nullish(),
  hardware_info: hardwareInfoSchema.nullish(),
});

export type DeviceEnrollRequest = z.infer<typeof deviceEnrollRequestSchema>;

/**
 * A health sample from a mirror.
 *
 * Every metric is nullish and stays null all the way into the database. A
 * mirror that could not measure its frame rate reports null, and null is
 * stored: substituting zero anywhere along this path would make an
 * unmeasured pipeline indistinguishable from a stalled one.
 */
export const deviceHeartbeatRequestSchema = z.object({
  app_version: semverSchema.nullish(),
  camera_ok: z.boolean().nullish(),
  render_fps: z.number().nonnegative().finite().max(10000).nullish(),
  processing_fps: z.number().nonnegative().finite().max(10000).nullish(),
  metrics: hardwareInfoSchema.nullish(),
});

export type DeviceHeartbeatRequest = z.infer<typeof deviceHeartbeatRequestSchema>;

/**
 * Staff-side display creation.
 *
 * `shop_id` is present because an org-wide admin has to say which shop the
 * mirror is going into. It is still checked server-side against the caller's
 * tenancy; being in the payload does not make it trusted.
 */
export const displayCreateSchema = z.object({
  shop_id: uuidSchema,
  name: shortTextSchema,
  slug: slugSchema,
});

export type DisplayCreate = z.infer<typeof displayCreateSchema>;

/** Result of `public.issue_device_enrollment_code`, parsed rather than cast. */
export const issuedEnrollmentCodeSchema = z.object({
  code_id: uuidSchema,
  expires_at: z.string(),
});

/** Result of `public.claim_device_enrollment_code`, parsed rather than cast. */
export const claimedEnrollmentSchema = z.object({
  display_id: uuidSchema,
  organization_id: uuidSchema,
  shop_id: uuidSchema,
  credential_id: uuidSchema,
  display_name: z.string(),
  display_slug: z.string(),
});
