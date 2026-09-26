/**
 * Pure helpers for commercial OVERLAY asset selection.
 *
 * No DB or network. Unit-testable without Supabase.
 */

import { OVERLAY_MIME_TYPES } from '@mirrorfit/tryon-core';

export type OverlayMime = (typeof OVERLAY_MIME_TYPES)[number];

export interface OverlayAssetCandidate {
  readonly variant_id: string | null;
  readonly mime_type: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly metadata: unknown;
}

export interface DrawableOverlayFields {
  readonly mime: OverlayMime;
  readonly width: number;
  readonly height: number;
  readonly anchor: { readonly x: number; readonly y: number } | null;
}

/**
 * Prefers a variant-specific OVERLAY row over a shared (null variant) asset.
 * Does not invent a row when neither exists.
 */
export function preferVariantOverlay<T extends { readonly variant_id: string | null }>(
  rows: readonly T[],
  variantId: string,
): T | null {
  if (!variantId || rows.length === 0) return null;
  const variantSpecific = rows.find((row) => row.variant_id === variantId);
  if (variantSpecific) return variantSpecific;
  const shared = rows.find((row) => row.variant_id === null);
  return shared ?? null;
}

export function normalizeOverlayMime(value: string | null | undefined): OverlayMime | null {
  if (!value) return null;
  const mime = value.split(';')[0]?.trim().toLowerCase() ?? '';
  if (OVERLAY_MIME_TYPES.includes(mime as OverlayMime)) {
    return mime as OverlayMime;
  }
  return null;
}

/**
 * Reads an optional normalized anchor from asset metadata.
 * Invalid or out-of-range values are ignored (null), never coerced.
 */
export function readOverlayAnchor(
  metadata: unknown,
): { readonly x: number; readonly y: number } | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const row = metadata as Record<string, unknown>;
  const anchor = row['anchor'];
  if (!anchor || typeof anchor !== 'object') return null;
  const point = anchor as Record<string, unknown>;
  if (typeof point['x'] !== 'number' || typeof point['y'] !== 'number') return null;
  if (!Number.isFinite(point['x']) || !Number.isFinite(point['y'])) return null;
  if (point['x'] < 0 || point['x'] > 1 || point['y'] < 0 || point['y'] > 1) return null;
  return { x: point['x'], y: point['y'] };
}

/**
 * Validates mime + dimensions for a drawable overlay.
 * Missing mime, jpeg, or non-positive dims → null (graceful fail).
 */
export function drawableOverlayFields(
  asset: Pick<OverlayAssetCandidate, 'mime_type' | 'width' | 'height' | 'metadata'>,
): DrawableOverlayFields | null {
  const mime = normalizeOverlayMime(asset.mime_type);
  if (!mime) return null;
  if (
    asset.width === null ||
    asset.height === null ||
    !Number.isFinite(asset.width) ||
    !Number.isFinite(asset.height) ||
    asset.width <= 0 ||
    asset.height <= 0
  ) {
    return null;
  }
  return {
    mime,
    width: asset.width,
    height: asset.height,
    anchor: readOverlayAnchor(asset.metadata),
  };
}
