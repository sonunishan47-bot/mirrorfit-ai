import { z } from 'zod';

import { tryOnJobStatusSchema } from './enums';
import { uuidSchema } from './primitives';

/**
 * Fields the mirror may send with one consented JPEG.
 * Tenancy is not in this schema. The device credential supplies it.
 */
export const tryOnJobCreateFieldsSchema = z.object({
  session_id: uuidSchema,
  garment_id: uuidSchema,
  variant_id: uuidSchema,
  policy_version: z.string().trim().min(1).max(40),
});

export const tryOnJobQueuedResponseSchema = z.object({
  job_id: uuidSchema,
  status: z.literal('QUEUED'),
});

export const currentTryOnJobSchema = z.object({
  job_id: uuidSchema,
  status: tryOnJobStatusSchema,
  error_code: z.string().nullable(),
  garment_id: uuidSchema,
  variant_id: uuidSchema,
  output_url: z.url().nullable(),
  expires_in: z.number().int().positive().max(3600).nullable(),
  vton_provider: z.enum(['not_connected', 'configured']),
});

export const currentTryOnJobResponseSchema = z.object({
  job: currentTryOnJobSchema.nullable(),
});

export const workerTryOnCompleteFieldsSchema = z.object({
  job_id: uuidSchema,
  status: z.enum(['SUCCEEDED', 'FAILED']),
  error_code: z.string().trim().min(1).max(80).optional(),
});

export type TryOnJobQueuedResponse = z.infer<typeof tryOnJobQueuedResponseSchema>;
export type CurrentTryOnJob = z.infer<typeof currentTryOnJobSchema>;
