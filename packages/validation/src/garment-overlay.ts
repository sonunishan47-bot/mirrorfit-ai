import { z } from 'zod';

import { uuidSchema } from './primitives';

const unitInterval = z.number().finite().min(0).max(1);

/**
 * Device-only overlay resolve response.
 *
 * Carries a short-lived signed URL for the enrolled mirror. Storage bucket
 * paths are not returned as a separate field; the phone catalog never sees
 * this payload.
 */
export const garmentOverlayResponseSchema = z.object({
  overlay_url: z.url(),
  expires_in: z.number().int().positive().max(3600),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mime_type: z.enum(['image/png', 'image/webp']),
  version: z.number().int().positive(),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  garment_id: uuidSchema,
  variant_id: uuidSchema.nullable(),
  anchor: z
    .object({
      x: unitInterval,
      y: unitInterval,
    })
    .nullable(),
});

export type GarmentOverlayResponse = z.infer<typeof garmentOverlayResponseSchema>;

export const garmentOverlayQuerySchema = z.object({
  garment_id: uuidSchema,
  variant_id: uuidSchema,
});
