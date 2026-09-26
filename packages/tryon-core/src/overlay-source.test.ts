import { describe, expect, it } from 'vitest';

import { overlaySourceForSelection } from './overlay-source';

describe('overlay source selection', () => {
  it('draws the labelled TEST FIXTURE for TOP selections', () => {
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: true,
        fitCategory: 'TOP',
      }),
    ).toBe('test_fixture');
  });

  it('draws a commercial TOP only when an overlay asset is loaded', () => {
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: false,
        fitCategory: 'TOP',
      }),
    ).toBe('none');
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: false,
        fitCategory: 'TOP',
        hasOverlayAsset: true,
      }),
    ).toBe('catalog_overlay');
  });

  it('does not invent an overlay when no garment is selected or category is unsupported', () => {
    expect(
      overlaySourceForSelection({
        selected: false,
        isTestFixture: true,
        fitCategory: 'TOP',
        hasOverlayAsset: true,
      }),
    ).toBe('none');
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: false,
        fitCategory: null,
        hasOverlayAsset: true,
      }),
    ).toBe('none');
  });

  it('draws LOWER_BODY fixtures and catalog overlays when assets are present', () => {
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: true,
        fitCategory: 'LOWER_BODY',
      }),
    ).toBe('test_fixture');
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: false,
        fitCategory: 'LOWER_BODY',
        hasOverlayAsset: true,
      }),
    ).toBe('catalog_overlay');
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: false,
        fitCategory: 'LOWER_BODY',
      }),
    ).toBe('none');
  });
});
