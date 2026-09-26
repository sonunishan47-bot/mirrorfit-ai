/**
 * Local catalog card images for labelled TEST FIXTURE garments.
 *
 * Served from `apps/web/public/fixtures/` — never from the private
 * garment-assets Storage bucket, never as signed commercial URLs.
 * Fitting still uses the in-browser geometric overlays.
 */

export const FIXTURE_TOP_THUMBNAIL_PATH = '/fixtures/test-fixture-top.svg';
export const FIXTURE_PANTS_THUMBNAIL_PATH = '/fixtures/test-fixture-pants.svg';

/**
 * Resolves a same-origin thumbnail path for known fixtures, or null.
 * Commercial garments stay without a client-invented image URL.
 */
export function fixtureCatalogThumbnailSrc(
  name: string,
  isTestFixture: boolean,
): string | null {
  if (!isTestFixture) return null;
  if (name === 'TEST FIXTURE TOP') return FIXTURE_TOP_THUMBNAIL_PATH;
  if (name === 'TEST FIXTURE PANTS') return FIXTURE_PANTS_THUMBNAIL_PATH;
  return null;
}
