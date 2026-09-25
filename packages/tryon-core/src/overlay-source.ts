import type { GarmentFitCategory } from '@mirrorfit/types';

export type OverlaySourceKind = 'test_fixture' | 'none';

/**
 * Decides what the overlay canvas may draw.
 *
 * Commercial overlay bytes are not loaded: storage paths stay off the
 * kiosk. The labelled test-fixture shirt is the only drawable source.
 * A real product without an overlay asset gets nothing, not a stand-in.
 */
export function overlaySourceForSelection(input: {
  readonly selected: boolean;
  readonly isTestFixture: boolean;
  readonly fitCategory: GarmentFitCategory | null;
}): OverlaySourceKind {
  if (!input.selected) return 'none';
  if (input.fitCategory !== 'TOP') return 'none';
  if (!input.isTestFixture) return 'none';
  return 'test_fixture';
}
