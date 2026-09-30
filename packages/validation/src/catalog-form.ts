import { z } from 'zod';

import { uuidSchema } from './primitives';

/** Categories the fitter already knows. Stored as the garment's category text. */
export const STAFF_GARMENT_CATEGORIES = [
  'Shirt',
  'Pants',
  'Dress',
  'Abaya',
  'Kurta',
  'Churidar',
  'Thobe',
  'Jeans',
] as const;

export const garmentCreateSchema = z.object({
  shop_id: uuidSchema,
  name: z.string().trim().min(1).max(200),
  sku: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$|^$/, 'use letters, numbers, or a hyphen'),
  category: z.enum(STAFF_GARMENT_CATEGORIES),
  color_name: z.string().trim().min(1).max(80),
  color_hex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'use a #rrggbb colour')
    .transform((value) => value.toLowerCase()),
  price_minor: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d+$/.test(value), 'price must be a whole number')
    .transform((value) => (value === '' ? null : Number(value)))
    .refine((value) => value === null || value <= 100_000_000, 'price is too large'),
});
