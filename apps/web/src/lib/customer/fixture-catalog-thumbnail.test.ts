import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FIXTURE_PANTS_THUMBNAIL_PATH,
  FIXTURE_TOP_THUMBNAIL_PATH,
  fixtureCatalogThumbnailSrc,
} from './fixture-catalog-thumbnail';

const PUBLIC_FIXTURES_DIR = join(process.cwd(), 'public', 'fixtures');

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

  it('ships public fixture SVGs as valid UTF-8 XML (Safari rejects Latin-1 bytes)', () => {
    const paths = [FIXTURE_TOP_THUMBNAIL_PATH, FIXTURE_PANTS_THUMBNAIL_PATH];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const publicPath of paths) {
      const fileName = publicPath.replace('/fixtures/', '');
      const bytes = readFileSync(join(PUBLIC_FIXTURES_DIR, fileName));
      expect(() => decoder.decode(bytes)).not.toThrow();
      const text = decoder.decode(bytes);
      expect(text.startsWith('<svg')).toBe(true);
      expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
    }
  });
});
