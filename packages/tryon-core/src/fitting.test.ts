import { describe, expect, it } from 'vitest';

import { deriveBodyGeometry } from './body-geometry';
import type { PoseFrame } from './geometry';
import {
  LandmarkFittingEngine,
  TOP_HEIGHT_FACTOR,
  TOP_VERTICAL_OFFSET,
  TOP_WIDTH_FACTOR,
} from './landmark-fitting-engine';
import { UnavailablePoseProvider } from './unavailable-pose-provider';
import { UnavailableSegmentationProvider } from './unavailable-segmentation';

/** Test fixture only. Not a live detection and not shown on the kiosk. */
const TEST_FIXTURE_POSE: PoseFrame = {
  timestampMs: 42,
  confidence: 0.8,
  keypoints: [
    { name: 'LEFT_SHOULDER', x: 0.35, y: 0.3, z: null, confidence: 0.9 },
    { name: 'RIGHT_SHOULDER', x: 0.65, y: 0.3, z: null, confidence: 0.9 },
    { name: 'LEFT_HIP', x: 0.4, y: 0.6, z: null, confidence: 0.85 },
    { name: 'RIGHT_HIP', x: 0.6, y: 0.6, z: null, confidence: 0.85 },
  ],
};

describe('unavailable providers', () => {
  it('never invents landmarks or a segmentation mask', async () => {
    const pose = new UnavailablePoseProvider();
    const segmentation = new UnavailableSegmentationProvider();
    await pose.initialize();
    await segmentation.initialize();
    expect(pose.availability).toBe('unavailable');
    expect(segmentation.availability).toBe('unavailable');
    expect(await pose.processFrame({ timestampMs: 1, width: 2, height: 2, source: {} as CanvasImageSource })).toBeNull();
    expect(await segmentation.segment({ timestampMs: 1, width: 2, height: 2, source: {} as CanvasImageSource })).toBeNull();
    expect(segmentation.readRegions(1).regions.every((region) => region.available === false)).toBe(
      true,
    );
    expect(segmentation.readRegions(1).regions.every((region) => region.confidence === null)).toBe(
      true,
    );
    expect(pose.lastError).toBeTruthy();
    expect(segmentation.lastError).toMatch(/torso\/arms\/lower-body/);
    await pose.dispose();
    await segmentation.dispose();
  });
});

describe('landmark fitting', () => {
  it('places a garment from real fixture landmarks', async () => {
    const engine = new LandmarkFittingEngine();
    await engine.initialize();
    await engine.loadGarment('g1', 'v1', 'Tops');
    const geometry = deriveBodyGeometry(TEST_FIXTURE_POSE);
    expect(geometry).not.toBeNull();
    const fit = await engine.fit({
      pose: TEST_FIXTURE_POSE,
      geometry: geometry!,
      segmentation: null,
      depth: null,
    });
    expect(geometry?.shoulderCenter.y).toBeCloseTo(0.3);
    expect(fit?.transform.translate.x).toBeCloseTo(0.5);
    expect(fit?.transform.translate.y).toBeCloseTo(0.3 + 0.3 * TOP_VERTICAL_OFFSET);
    expect(fit?.transform.scaleX).toBeCloseTo(0.3 * TOP_WIDTH_FACTOR);
    expect(fit?.transform.scaleY).toBeCloseTo(0.3 * TOP_HEIGHT_FACTOR);
    expect(fit?.transform.rotation).toBeCloseTo(0);
    await engine.dispose();
  });

  it('does not invent TOP fitting when category is missing', async () => {
    const engine = new LandmarkFittingEngine();
    await engine.loadGarment('g1', 'v1');
    const geometry = deriveBodyGeometry(TEST_FIXTURE_POSE);
    const fit = await engine.fit({
      pose: TEST_FIXTURE_POSE,
      geometry: geometry!,
      segmentation: null,
      depth: null,
    });
    expect(fit).toBeNull();
    expect(engine.lastStatus).toBe('not_ready');
    await engine.dispose();
  });

  it('rejects non-finite geometry instead of drawing garbage', async () => {
    const engine = new LandmarkFittingEngine();
    await engine.loadGarment('g1', 'v1', 'Tops');
    const geometry = deriveBodyGeometry(TEST_FIXTURE_POSE)!;
    const fit = await engine.fit({
      pose: TEST_FIXTURE_POSE,
      geometry: { ...geometry, roll: Number.NaN },
      segmentation: null,
      depth: null,
    });
    expect(fit).toBeNull();
    expect(engine.lastStatus).toBe('not_ready');
    await engine.dispose();
  });

  it('tracks a person who moves left/right and closer/farther', async () => {
    const engine = new LandmarkFittingEngine();
    await engine.loadGarment('g1', 'v1', 'Tops');
    const leftClose: PoseFrame = {
      timestampMs: 1,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.1, y: 0.25, z: null, confidence: 0.9 },
        { name: 'RIGHT_SHOULDER', x: 0.5, y: 0.25, z: null, confidence: 0.9 },
        { name: 'LEFT_HIP', x: 0.15, y: 0.7, z: null, confidence: 0.9 },
        { name: 'RIGHT_HIP', x: 0.45, y: 0.7, z: null, confidence: 0.9 },
      ],
    };
    const rightFar: PoseFrame = {
      timestampMs: 2,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.55, y: 0.35, z: null, confidence: 0.9 },
        { name: 'RIGHT_SHOULDER', x: 0.75, y: 0.35, z: null, confidence: 0.9 },
        { name: 'LEFT_HIP', x: 0.58, y: 0.55, z: null, confidence: 0.9 },
        { name: 'RIGHT_HIP', x: 0.72, y: 0.55, z: null, confidence: 0.9 },
      ],
    };
    const leftGeo = deriveBodyGeometry(leftClose)!;
    const rightGeo = deriveBodyGeometry(rightFar)!;
    const leftFit = await engine.fit({
      pose: leftClose,
      geometry: leftGeo,
      segmentation: null,
      depth: null,
    });
    const rightFit = await engine.fit({
      pose: rightFar,
      geometry: rightGeo,
      segmentation: null,
      depth: null,
    });
    expect(leftFit!.transform.translate.x).toBeLessThan(rightFit!.transform.translate.x);
    expect(leftFit!.transform.scaleX).toBeGreaterThan(rightFit!.transform.scaleX);
    expect(leftFit!.transform.scaleY).toBeGreaterThan(rightFit!.transform.scaleY);
    await engine.dispose();
  });

  it('rejects extreme roll instead of inventing a front-facing shirt', async () => {
    const engine = new LandmarkFittingEngine();
    await engine.loadGarment('g1', 'v1', 'Tops');
    const extreme: PoseFrame = {
      timestampMs: 3,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.5, y: 0.1, z: null, confidence: 0.9 },
        { name: 'RIGHT_SHOULDER', x: 0.5, y: 0.5, z: null, confidence: 0.9 },
        { name: 'LEFT_HIP', x: 0.45, y: 0.7, z: null, confidence: 0.9 },
        { name: 'RIGHT_HIP', x: 0.55, y: 0.7, z: null, confidence: 0.9 },
      ],
    };
    const geometry = deriveBodyGeometry(extreme);
    expect(geometry).not.toBeNull();
    expect(Math.abs(geometry!.roll)).toBeGreaterThan(Math.PI / 3);
    const fit = await engine.fit({
      pose: extreme,
      geometry: geometry!,
      segmentation: null,
      depth: null,
    });
    expect(fit).toBeNull();
    expect(engine.lastStatus).toBe('not_ready');
    await engine.dispose();
  });

  it('returns null when the garment is not loaded', async () => {
    const engine = new LandmarkFittingEngine();
    const geometry = deriveBodyGeometry(TEST_FIXTURE_POSE);
    const fit = await engine.fit({
      pose: TEST_FIXTURE_POSE,
      geometry: geometry!,
      segmentation: null,
      depth: null,
    });
    expect(fit).toBeNull();
  });

  it('returns null when shoulders are missing', () => {
    expect(
      deriveBodyGeometry({
        timestampMs: 1,
        confidence: 1,
        keypoints: [{ name: 'NOSE', x: 0.5, y: 0.2, z: null, confidence: 1 }],
      }),
    ).toBeNull();
  });

  it('returns null when a hip is missing', () => {
    expect(
      deriveBodyGeometry({
        timestampMs: 1,
        confidence: 1,
        keypoints: [
          { name: 'LEFT_SHOULDER', x: 0.3, y: 0.3, z: null, confidence: 0.9 },
          { name: 'RIGHT_SHOULDER', x: 0.7, y: 0.3, z: null, confidence: 0.9 },
          { name: 'LEFT_HIP', x: 0.4, y: 0.6, z: null, confidence: 0.9 },
        ],
      }),
    ).toBeNull();
  });

  it('returns null when required landmarks are below the confidence floor', () => {
    expect(
      deriveBodyGeometry({
        timestampMs: 1,
        confidence: 1,
        keypoints: [
          { name: 'LEFT_SHOULDER', x: 0.3, y: 0.3, z: null, confidence: 0.1 },
          { name: 'RIGHT_SHOULDER', x: 0.7, y: 0.3, z: null, confidence: 0.9 },
          { name: 'LEFT_HIP', x: 0.4, y: 0.6, z: null, confidence: 0.9 },
          { name: 'RIGHT_HIP', x: 0.6, y: 0.6, z: null, confidence: 0.9 },
        ],
      }),
    ).toBeNull();
  });

  it('derives roll and yaw from a tilted, depth-aware fixture', () => {
    const geometry = deriveBodyGeometry({
      timestampMs: 8,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.3, y: 0.25, z: 0.1, confidence: 0.9 },
        { name: 'RIGHT_SHOULDER', x: 0.7, y: 0.35, z: -0.1, confidence: 0.9 },
        { name: 'LEFT_HIP', x: 0.35, y: 0.7, z: null, confidence: 0.9 },
        { name: 'RIGHT_HIP', x: 0.65, y: 0.7, z: null, confidence: 0.9 },
      ],
    });
    expect(geometry).not.toBeNull();
    expect(geometry?.roll).toBeGreaterThan(0);
    expect(geometry?.yaw).toBeCloseTo(-0.2);
    expect(geometry?.center.x).toBeCloseTo(0.5);
  });

  it('treats mirrored coordinates as valid normalized geometry', () => {
    const geometry = deriveBodyGeometry({
      timestampMs: 2,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.65, y: 0.3, z: null, confidence: 0.9 },
        { name: 'RIGHT_SHOULDER', x: 0.35, y: 0.3, z: null, confidence: 0.9 },
        { name: 'LEFT_HIP', x: 0.6, y: 0.6, z: null, confidence: 0.9 },
        { name: 'RIGHT_HIP', x: 0.4, y: 0.6, z: null, confidence: 0.9 },
      ],
    });
    expect(geometry?.shoulderWidth).toBeCloseTo(0.3);
    expect(geometry?.center.x).toBeCloseTo(0.5);
  });

  it('returns null for an extreme pose that collapses torso height', () => {
    expect(
      deriveBodyGeometry({
        timestampMs: 3,
        confidence: 1,
        keypoints: [
          { name: 'LEFT_SHOULDER', x: 0.4, y: 0.5, z: null, confidence: 0.9 },
          { name: 'RIGHT_SHOULDER', x: 0.6, y: 0.5, z: null, confidence: 0.9 },
          { name: 'LEFT_HIP', x: 0.4, y: 0.5, z: null, confidence: 0.9 },
          { name: 'RIGHT_HIP', x: 0.6, y: 0.5, z: null, confidence: 0.9 },
        ],
      }),
    ).toBeNull();
  });

  it('does not invent a fit for lower-body categories', async () => {
    const engine = new LandmarkFittingEngine();
    await engine.loadGarment('g1', 'v1', 'Jeans');
    const geometry = deriveBodyGeometry(TEST_FIXTURE_POSE);
    const fit = await engine.fit({
      pose: TEST_FIXTURE_POSE,
      geometry: geometry!,
      segmentation: null,
      depth: null,
    });
    expect(fit).toBeNull();
    expect(engine.lastStatus).toBe('lower_body_not_implemented');
  });

  it('does not invent a fit when overall pose confidence is too low', async () => {
    const engine = new LandmarkFittingEngine();
    await engine.loadGarment('g1', 'v1', 'T-Shirt');
    const low: PoseFrame = { ...TEST_FIXTURE_POSE, confidence: 0.05 };
    const geometry = deriveBodyGeometry(low);
    const fit = await engine.fit({
      pose: low,
      geometry: geometry!,
      segmentation: null,
      depth: null,
    });
    expect(fit).toBeNull();
    expect(engine.lastStatus).toBe('not_ready');
  });
});
