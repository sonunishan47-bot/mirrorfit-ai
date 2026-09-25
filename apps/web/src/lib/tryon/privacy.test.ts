import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const webRoot = resolve(import.meta.dirname, '../..');

function source(relative: string): string {
  return readFileSync(resolve(webRoot, relative), 'utf8');
}

describe('Phase 5 privacy invariants', () => {
  it('does not upload camera frames or persist biometrics from the try-on path', () => {
    const panel = source('app/mirror/tryon-panel.tsx');
    const pose = source('lib/tryon/mediapipe-pose-provider.ts');
    const combined = `${panel}\n${pose}`;
    expect(combined).not.toMatch(/fetch\(.*frame|uploadFrame|toDataURL|toBlob/i);
    expect(combined).not.toMatch(/SUPABASE_SECRET_KEY|SERVICE_ROLE|sb_secret_/);
    expect(combined).not.toMatch(/NEXT_PUBLIC_SUPABASE_SECRET/);
    expect(combined).not.toMatch(/console\.(log|debug|info)\(.*landmark|console\.(log|debug|info)\(.*frame/i);
    expect(pose).toContain('detectForVideo');
    expect(pose).toContain('MEDIAPIPE_POSE_MODEL_URL');
  });

  it('does not expose device secrets or storage paths on phone catalog surfaces', () => {
    const catalog = source('lib/customer/catalog-client.ts');
    const phone = source('app/s/session-catalog.tsx');
    const combined = `${catalog}\n${phone}`;
    expect(combined).not.toMatch(/device_secret|SUPABASE_SECRET_KEY|storage_path|organization_id/);
  });

  it('keeps the official model URL on Google storage and local WASM', () => {
    const pose = source('lib/tryon/mediapipe-pose-provider.ts');
    expect(pose).toContain(
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    );
    expect(pose).toContain('/mediapipe/wasm');
    expect(pose).not.toContain('cdn.jsdelivr.net');
  });
});
