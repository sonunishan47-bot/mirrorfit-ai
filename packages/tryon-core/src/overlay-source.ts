import type { GarmentFitCategory } from '@mirrorfit/types';

export type OverlaySourceKind =
  'test_fixture' | 'catalog_overlay' | 'full_body_silhouette' | 'none';

/**
 * Decides what the overlay canvas may draw.
 *
 * - Test fixtures use the labelled in-browser geometric shirt/pants.
 * - Commercial TOP / LOWER_BODY draw only when an OVERLAY asset was resolved
 *   and loaded.
 * - Known full-body categories draw a pose silhouette. An uploaded OVERLAY
 *   replaces that silhouette. Neither one is a photorealistic try-on.
 * - Missing assets stay `none` — never a stand-in product image.
 */
export function overlaySourceForSelection(input: {
  readonly selected: boolean;
  readonly isTestFixture: boolean;
  readonly fitCategory: GarmentFitCategory | null;
  readonly hasOverlayAsset?: boolean;
}): OverlaySourceKind {
  if (!input.selected) return 'none';
  if (input.fitCategory === 'FULL_BODY') {
    if (input.hasOverlayAsset === true && !input.isTestFixture) return 'catalog_overlay';
    return 'full_body_silhouette';
  }
  if (input.fitCategory !== 'TOP' && input.fitCategory !== 'LOWER_BODY') return 'none';
  if (input.isTestFixture) return 'test_fixture';
  if (input.hasOverlayAsset === true) return 'catalog_overlay';
  return 'none';
}
