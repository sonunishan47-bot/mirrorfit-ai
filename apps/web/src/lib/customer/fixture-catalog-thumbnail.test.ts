import { describe, expect, it } from 'vitest';

import {
  FIXTURE_PANTS_THUMBNAIL_PATH,
  FIXTURE_TOP_THUMBNAIL_PATH,
  fixtureCatalogThumbnailSrc,
} from './fixture-catalog-thumbnail';

describe('fixture catalog thumbnails', () => {
  it('maps known TEST FIXTURE names to local public SVG paths', () => {
    expect(fixtureCatalogThumbnailSrc('TEST FIXTURE TOP', true)).toBe(FIXTURE_TOP_THUMBNAIL_PATH);
    expect(fixtureCatalogThumbnailSrc('TEST FIXTURE PANTS', true)).toBe(
      FIXTURE_PANTS_THUMBNAIL_PATH,
    );
    expect(FIXTURE_TOP_THUMBNAIL_PATH.startsWith('/fixtures/')).toBe(true);
    expect(FIXTURE_PANTS_THUMBNAIL_PATH.startsWith('/fixtures/')).toBe(true);
  });

  it('never invents a thumbnail for commercial or unknown names', () => {
    expect(fixtureCatalogThumbnailSrc('Shop Tee', false)).toBeNull();
    expect(fixtureCatalogThumbnailSrc('Shop Tee', true)).toBeNull();
    expect(fixtureCatalogThumbnailSrc('TEST FIXTURE TOP', false)).toBeNull();
  });
});
