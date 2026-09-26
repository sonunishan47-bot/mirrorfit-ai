import {
  BODY_REGIONS,
  GARMENT_AUDIENCES,
  POSE_LANDMARKS,
  TRYON_PROVIDER_AVAILABILITIES,
  TRYON_RUNTIME_STATUSES,
} from '@mirrorfit/types';
import { z } from 'zod';

import { nonNegativeNumberSchema, uuidSchema } from './primitives';

export const poseLandmarkNameSchema = z.enum(POSE_LANDMARKS);
export const bodyRegionNameSchema = z.enum(BODY_REGIONS);
export const tryOnRuntimeStatusSchema = z.enum(TRYON_RUNTIME_STATUSES);
export const tryOnProviderAvailabilitySchema = z.enum(TRYON_PROVIDER_AVAILABILITIES);
export const garmentAudienceSchema = z.enum(GARMENT_AUDIENCES);

const unitInterval = z.number().min(0).max(1).finite();

export const keypointSchema = z.object({
  name: poseLandmarkNameSchema,
  x: unitInterval,
  y: unitInterval,
  z: z.number().finite().nullable(),
  confidence: unitInterval,
});

export const poseFrameSchema = z.object({
  timestampMs: nonNegativeNumberSchema,
  keypoints: z.array(keypointSchema).max(POSE_LANDMARKS.length),
  confidence: unitInterval,
});

export const bodyRegionObservationSchema = z.object({
  region: bodyRegionNameSchema,
  available: z.boolean(),
  confidence: unitInterval.nullable(),
});

export const bodyRegionMapSchema = z.object({
  timestampMs: nonNegativeNumberSchema,
  source: z.enum(['unavailable', 'segmentation', 'pose_derived']),
  regions: z.array(bodyRegionObservationSchema),
});

export const selectedGarmentSchema = z.object({
  garment_id: uuidSchema,
  variant_id: uuidSchema,
  category: z.string().trim().min(1).max(80).optional(),
  is_test_fixture: z.boolean().optional(),
});

export const customerCatalogItemSchema = z.object({
  garment_id: uuidSchema,
  variant_id: uuidSchema,
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  brand: z.string().trim().min(1).max(120).nullable(),
  color_name: z.string().trim().min(1).max(80),
  price_minor: z.number().int().nonnegative().nullable(),
  currency_code: z.string().regex(/^[A-Z]{3}$/).nullable(),
  audience: garmentAudienceSchema.nullable(),
  sizes: z.array(z.string().trim().min(1).max(8)).max(12),
  is_test_fixture: z.boolean(),
  has_thumbnail: z.boolean(),
  has_overlay: z.boolean(),
  fitting_available: z.boolean(),
});

export const catalogGarmentRowSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  shop_id: uuidSchema,
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  brand: z.string().trim().min(1).max(120).nullable(),
  price_minor: z.number().int().nonnegative().nullable(),
  currency_code: z.string().length(3).nullable(),
  is_active: z.boolean(),
});
