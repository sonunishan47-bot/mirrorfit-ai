import { describe, expect, it } from 'vitest';

import {
  drawableOverlayFields,
  normalizeOverlayMime,
  preferVariantOverlay,
  readOverlayAnchor,
} from './garment-overlay-helpers';

const VARIANT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

describe('preferVariantOverlay', () => {
  it('prefers a variant-specific OVERLAY over a shared asset', () => {
    const rows = [
      { variant_id: null as string | null, version: 2, label: 'shared' },
      { variant_id: VARIANT, version: 1, label: 'variant' },
    ];
    expect(preferVariantOverlay(rows, VARIANT)?.label).toBe('variant');
  });

  it('falls back to a shared asset when no variant row exists', () => {
    const rows = [{ variant_id: null as string | null, label: 'shared' }];
    expect(preferVariantOverlay(rows, VARIANT)?.label).toBe('shared');
  });

  it('returns null when neither variant nor shared exists', () => {
    const rows = [{ variant_id: OTHER, label: 'other' }];
    expect(preferVariantOverlay(rows, VARIANT)).toBeNull();
    expect(preferVariantOverlay([], VARIANT)).toBeNull();
  });
});

describe('normalizeOverlayMime', () => {
  it('accepts png and webp, including charset suffixes', () => {
    expect(normalizeOverlayMime('image/png')).toBe('image/png');
    expect(normalizeOverlayMime('image/webp; charset=binary')).toBe('image/webp');
  });

  it('rejects jpeg and missing mime instead of inventing png', () => {
    expect(normalizeOverlayMime('image/jpeg')).toBeNull();
    expect(normalizeOverlayMime('image/jpg')).toBeNull();
    expect(normalizeOverlayMime(null)).toBeNull();
    expect(normalizeOverlayMime('')).toBeNull();
  });
});

describe('readOverlayAnchor', () => {
  it('reads a valid normalized anchor', () => {
    expect(readOverlayAnchor({ anchor: { x: 0.5, y: 0.25 } })).toEqual({ x: 0.5, y: 0.25 });
  });

  it('ignores invalid anchors without coercing', () => {
    expect(readOverlayAnchor({ anchor: { x: 1.5, y: 0.2 } })).toBeNull();
    expect(readOverlayAnchor({ anchor: { x: '0.5', y: 0.2 } })).toBeNull();
    expect(readOverlayAnchor({ anchor: null })).toBeNull();
    expect(readOverlayAnchor(null)).toBeNull();
    expect(readOverlayAnchor({})).toBeNull();
  });
});

describe('drawableOverlayFields', () => {
  it('returns null when mime or dimensions are missing', () => {
    expect(
      drawableOverlayFields({
        mime_type: null,
        width: 400,
        height: 600,
        metadata: null,
      }),
    ).toBeNull();
    expect(
      drawableOverlayFields({
        mime_type: 'image/png',
        width: null,
        height: 600,
        metadata: null,
      }),
    ).toBeNull();
    expect(
      drawableOverlayFields({
        mime_type: 'image/png',
        width: 400,
        height: 0,
        metadata: null,
      }),
    ).toBeNull();
  });

  it('rejects jpeg even when dimensions exist', () => {
    expect(
      drawableOverlayFields({
        mime_type: 'image/jpeg',
        width: 400,
        height: 600,
        metadata: { anchor: { x: 0.5, y: 0.2 } },
      }),
    ).toBeNull();
  });

  it('returns drawable fields with optional anchor when valid', () => {
    expect(
      drawableOverlayFields({
        mime_type: 'image/webp',
        width: 400,
        height: 600,
        metadata: { anchor: { x: 0.5, y: 0.22 } },
      }),
    ).toEqual({
      mime: 'image/webp',
      width: 400,
      height: 600,
      anchor: { x: 0.5, y: 0.22 },
    });
  });

  it('ignores invalid anchor but still returns drawable dims', () => {
    expect(
      drawableOverlayFields({
        mime_type: 'image/png',
        width: 200,
        height: 300,
        metadata: { anchor: { x: -1, y: 0.5 } },
      }),
    ).toEqual({
      mime: 'image/png',
      width: 200,
      height: 300,
      anchor: null,
    });
  });
});
