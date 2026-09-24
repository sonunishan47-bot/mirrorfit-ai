import { z } from 'zod';

export const uuidSchema = z.uuid();

/** ISO 8601 timestamp with timezone, as produced by `new Date().toISOString()`. */
export const isoTimestampSchema = z.iso.datetime({ offset: true });

export const nonEmptyStringSchema = z.string().trim().min(1);

/** Human-facing free text with an upper bound, to keep payloads and logs sane. */
export const shortTextSchema = z.string().trim().min(1).max(200);
export const longTextSchema = z.string().trim().min(1).max(2000);

/**
 * Lowercase SHA-256 hex digest. Used for garment asset content hashes (cache
 * invalidation on the mirror) and for hashed pairing tokens.
 */
export const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a lowercase sha-256 hex digest');

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase kebab-case slug')
  .max(64);

/** Semantic version of the mirror kiosk build, e.g. `1.4.2`. */
export const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'must be a semantic version');

export const positiveIntSchema = z.int().positive();
export const nonNegativeNumberSchema = z.number().nonnegative().finite();

/** Confidence for any AI-derived suggestion. Always a suggestion, never a fact. */
export const confidenceSchema = z.number().min(0).max(1);

/** Body measurement in centimetres, bounded to physically plausible values. */
export const centimetresSchema = z.number().positive().finite().max(400);
