import { describe, expect, it } from 'vitest';

import { deriveBodyGeometry } from './body-geometry';
import type { PoseFrame } from './geometry';
import {
  DEFAULT_HIP_WIDTH_BLEND,
  LandmarkFittingEngine,
  TOP_HEIGHT_FACTOR,
  TOP_VERTICAL_OFFSET,
  TOP_WIDTH_FACTOR,
  yawScaleCompression,
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
    expect(
      await pose.processFrame({
        timestampMs: 1,
        width: 2,
        height: 2,
        source: {} as CanvasImageSource,
      }),
    ).toBeNull();
    expect(
      await segmentation.segment({
        timestampMs: 1,
        width: 2,
        height: 2,
        source: {} as CanvasImageSource,
      }),
    ).toBeNull();
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
    const blendedWidth =
      geometry!.shoulderWidth * (1 - DEFAULT_HIP_WIDTH_BLEND) +
      geometry!.hipWidth * DEFAULT_HIP_WIDTH_BLEND;
    expect(fit?.transform.scaleX).toBeCloseTo(blendedWidth * TOP_WIDTH_FACTOR);
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

  it('anchors commercial tops on the shoulder line without inventing a pose', async () => {
    const engine = new LandmarkFittingEngine();
    engine.setAnchorMode('shoulders');
    await engine.loadGarment('g1', 'v1', 'Tops');
    const geometry = deriveBodyGeometry(TEST_FIXTURE_POSE)!;
    const fit = await engine.fit({
      pose: TEST_FIXTURE_POSE,
      geometry,
      segmentation: null,
      depth: null,
    });
    expect(fit?.transform.translate.x).toBeCloseTo(geometry.shoulderCenter.x);
    expect(fit?.transform.translate.y).toBeCloseTo(geometry.shoulderCenter.y);
    expect(fit?.transform.translate.y).toBeLessThan(
      geometry.shoulderCenter.y + geometry.torsoHeight * TOP_VERTICAL_OFFSET,
    );
    await engine.dispose();
  });

  it('shrinks scaleX from real shoulder yaw without inventing a side view', async () => {
    const engine = new LandmarkFittingEngine();
    engine.setAnchorMode('shoulders');
    engine.setHipWidthBlend(0);
    await engine.loadGarment('g1', 'v1', 'Jacket');
    const frontGeo = deriveBodyGeometry(TEST_FIXTURE_POSE)!;
    const frontFit = await engine.fit({
      pose: TEST_FIXTURE_POSE,
      geometry: frontGeo,
      segmentation: null,
      depth: null,
    });
    engine.clearGarment();
    await engine.loadGarment('g1', 'v1', 'Jacket');
    engine.setAnchorMode('shoulders');
    engine.setHipWidthBlend(0);
    const turned: PoseFrame = {
      timestampMs: 9,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.35, y: 0.3, z: 0.25, confidence: 0.9 },
        { name: 'RIGHT_SHOULDER', x: 0.65, y: 0.3, z: -0.25, confidence: 0.9 },
        { name: 'LEFT_HIP', x: 0.4, y: 0.6, z: null, confidence: 0.85 },
        { name: 'RIGHT_HIP', x: 0.6, y: 0.6, z: null, confidence: 0.85 },
      ],
    };
    const turnedGeo = deriveBodyGeometry(turned)!;
    expect(Math.abs(turnedGeo.yaw)).toBeGreaterThan(Math.abs(frontGeo.yaw));
    const turnedFit = await engine.fit({
      pose: turned,
      geometry: turnedGeo,
      segmentation: null,
      depth: null,
    });
    expect(turnedFit!.transform.scaleX).toBeLessThan(frontFit!.transform.scaleX);
    expect(yawScaleCompression(turnedGeo.yaw)).toBeLessThan(1);
    expect(turnedFit!.transform.translate.y).toBeCloseTo(turnedGeo.shoulderCenter.y);
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

  it('derives TOP geometry when hips sit slightly past the frame edge', () => {
    const geometry = deriveBodyGeometry({
      timestampMs: 11,
      confidence: 0.5,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.35, y: 0.28, z: null, confidence: 0.9 },
        { name: 'RIGHT_SHOULDER', x: 0.65, y: 0.28, z: null, confidence: 0.9 },
        { name: 'LEFT_HIP', x: 0.4, y: 1.05, z: null, confidence: 0.85 },
        { name: 'RIGHT_HIP', x: 0.6, y: 1.04, z: null, confidence: 0.84 },
      ],
    });
    expect(geometry).not.toBeNull();
    expect(geometry!.torsoHeight).toBeGreaterThan(0.5);
    expect(geometry!.hipCenter.y).toBeGreaterThan(1);
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

  it('fits TOP from joint confidence even when low-visibility extremities dilute pose.confidence', async () => {
    const engine = new LandmarkFittingEngine();
    engine.setAnchorMode('shoulders');
    await engine.loadGarment('g1', 'v1', 'Tops');
    const pose: PoseFrame = {
      timestampMs: 9,
      // Diluted by ankles/wrists — previously blocked fitting at MIN_POSE_CONFIDENCE.
      confidence: 0.12,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.35, y: 0.3, z: null, confidence: 0.92 },
        { name: 'RIGHT_SHOULDER', x: 0.65, y: 0.3, z: null, confidence: 0.9 },
        { name: 'LEFT_HIP', x: 0.4, y: 0.62, z: null, confidence: 0.88 },
        { name: 'RIGHT_HIP', x: 0.6, y: 0.62, z: null, confidence: 0.86 },
        { name: 'LEFT_WRIST', x: 0.2, y: 0.55, z: null, confidence: 0.05 },
        { name: 'RIGHT_WRIST', x: 0.8, y: 0.55, z: null, confidence: 0.04 },
        { name: 'LEFT_ANKLE', x: 0.42, y: 0.95, z: null, confidence: 0.03 },
        { name: 'RIGHT_ANKLE', x: 0.58, y: 0.95, z: null, confidence: 0.02 },
      ],
    };
    const fit = await engine.fit({
      pose,
      geometry: deriveBodyGeometry(pose),
      segmentation: null,
      depth: null,
    });
    expect(fit).not.toBeNull();
    expect(engine.lastStatus).toBe('ready');
    expect(fit!.confidence).toBeGreaterThanOrEqual(0.86);
  });

  it('fits lower-body categories from hip and ankle landmarks', async () => {
    const engine = new LandmarkFittingEngine();
    engine.setAnchorMode('hips');
    await engine.loadGarment('g1', 'v1', 'Jeans');
    const lowerPose: PoseFrame = {
      timestampMs: 42,
      confidence: 0.85,
      keypoints: [
        { name: 'LEFT_HIP', x: 0.4, y: 0.55, z: null, confidence: 0.9 },
        { name: 'RIGHT_HIP', x: 0.6, y: 0.55, z: null, confidence: 0.9 },
        { name: 'LEFT_KNEE', x: 0.42, y: 0.72, z: null, confidence: 0.85 },
        { name: 'RIGHT_KNEE', x: 0.58, y: 0.72, z: null, confidence: 0.85 },
        { name: 'LEFT_ANKLE', x: 0.43, y: 0.9, z: null, confidence: 0.8 },
        { name: 'RIGHT_ANKLE', x: 0.57, y: 0.9, z: null, confidence: 0.8 },
      ],
    };
    const fit = await engine.fit({
      pose: lowerPose,
      geometry: null,
      segmentation: null,
      depth: null,
    });
    expect(fit).not.toBeNull();
    expect(engine.lastStatus).toBe('ready');
    expect(fit!.transform.translate.x).toBeCloseTo(0.5);
    expect(fit!.transform.translate.y).toBeCloseTo(0.55);
    expect(fit!.transform.scaleX).toBeGreaterThan(0);
    expect(fit!.transform.scaleY).toBeGreaterThan(0);
  });

  it('returns not_ready for lower-body when ankles and knees are missing', async () => {
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
    expect(engine.lastStatus).toBe('not_ready');
  });

  it('does not invent a fit when fitting-joint confidence is too low', async () => {
    const engine = new LandmarkFittingEngine();
    await engine.loadGarment('g1', 'v1', 'T-Shirt');
    const lowJoints: PoseFrame = {
      timestampMs: 42,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.35, y: 0.3, z: null, confidence: 0.1 },
        { name: 'RIGHT_SHOULDER', x: 0.65, y: 0.3, z: null, confidence: 0.1 },
        { name: 'LEFT_HIP', x: 0.4, y: 0.6, z: null, confidence: 0.1 },
        { name: 'RIGHT_HIP', x: 0.6, y: 0.6, z: null, confidence: 0.1 },
      ],
    };
    const fit = await engine.fit({
      pose: lowJoints,
      geometry: deriveBodyGeometry(lowJoints),
      segmentation: null,
      depth: null,
    });
    expect(fit).toBeNull();
    expect(engine.lastStatus).toBe('not_ready');
  });

  it('EMA-smooths successive fits so a jump is damped without inventing pose', async () => {
    const engine = new LandmarkFittingEngine();
    engine.setAnchorMode('shoulders');
    await engine.loadGarment('g1', 'v1', 'Tops');
    const firstGeo = deriveBodyGeometry(TEST_FIXTURE_POSE)!;
    const first = await engine.fit({
      pose: TEST_FIXTURE_POSE,
      geometry: firstGeo,
      segmentation: null,
      depth: null,
    });
    const jumped: PoseFrame = {
      timestampMs: 50,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.55, y: 0.3, z: null, confidence: 0.9 },
        { name: 'RIGHT_SHOULDER', x: 0.85, y: 0.3, z: null, confidence: 0.9 },
        { name: 'LEFT_HIP', x: 0.6, y: 0.6, z: null, confidence: 0.85 },
        { name: 'RIGHT_HIP', x: 0.8, y: 0.6, z: null, confidence: 0.85 },
      ],
    };
    const jumpedGeo = deriveBodyGeometry(jumped)!;
    const second = await engine.fit({
      pose: jumped,
      geometry: jumpedGeo,
      segmentation: null,
      depth: null,
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // Smoothed x sits strictly between the previous sample and the raw jump target.
    expect(second!.transform.translate.x).toBeGreaterThan(first!.transform.translate.x);
    expect(second!.transform.translate.x).toBeLessThan(jumpedGeo.shoulderCenter.x);
    await engine.dispose();
  });
  it('holds the last good fit across brief weak frames (hysteresis)', async () => {
    const engine = new LandmarkFittingEngine();
    engine.setAnchorMode('shoulders');
    await engine.loadGarment('g1', 'v1', 'Tops');
    const good = await engine.fit({
      pose: TEST_FIXTURE_POSE,
      geometry: deriveBodyGeometry(TEST_FIXTURE_POSE),
      segmentation: null,
      depth: null,
    });
    expect(good).not.toBeNull();
    expect(engine.lastStatus).toBe('ready');

    const weak: PoseFrame = {
      timestampMs: 99,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.35, y: 0.3, z: null, confidence: 0.05 },
        { name: 'RIGHT_SHOULDER', x: 0.65, y: 0.3, z: null, confidence: 0.05 },
        { name: 'LEFT_HIP', x: 0.4, y: 0.6, z: null, confidence: 0.05 },
        { name: 'RIGHT_HIP', x: 0.6, y: 0.6, z: null, confidence: 0.05 },
      ],
    };
    const held = await engine.fit({
      pose: weak,
      geometry: deriveBodyGeometry(weak),
      segmentation: null,
      depth: null,
    });
    expect(held).not.toBeNull();
    expect(engine.lastStatus).toBe('ready');
    expect(held!.transform.translate.x).toBeCloseTo(good!.transform.translate.x);
    expect(held!.confidence).toBeLessThan(good!.confidence);

    engine.clearHeldFit();
    const afterClear = await engine.fit({
      pose: weak,
      geometry: deriveBodyGeometry(weak),
      segmentation: null,
      depth: null,
    });
    expect(afterClear).toBeNull();
    expect(engine.lastStatus).toBe('not_ready');
  });

  it('fits TOP when joint confidence is laptop-tolerant mid-range', async () => {
    const engine = new LandmarkFittingEngine();
    engine.setAnchorMode('shoulders');
    await engine.loadGarment('g1', 'v1', 'Tops');
    const mid: PoseFrame = {
      timestampMs: 7,
      confidence: 0.3,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.35, y: 0.3, z: null, confidence: 0.25 },
        { name: 'RIGHT_SHOULDER', x: 0.65, y: 0.3, z: null, confidence: 0.25 },
        { name: 'LEFT_HIP', x: 0.4, y: 0.62, z: null, confidence: 0.24 },
        { name: 'RIGHT_HIP', x: 0.6, y: 0.62, z: null, confidence: 0.24 },
      ],
    };
    const fit = await engine.fit({
      pose: mid,
      geometry: deriveBodyGeometry(mid),
      segmentation: null,
      depth: null,
    });
    expect(deriveBodyGeometry(mid)).not.toBeNull();
    expect(fit).not.toBeNull();
    expect(engine.lastStatus).toBe('ready');
  });
});
