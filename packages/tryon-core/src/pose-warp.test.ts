import { describe, expect, it } from 'vitest';

import { deriveBodyGeometry } from './body-geometry';
import { fullBodyOverlayDefaults } from './fit-category';
import type { PoseFrame } from './geometry';
import { deriveLowerBodyGeometry } from './lower-body-geometry';
import {
  drawImageInParallelogram,
  lowerBodyWarpParallelogram,
  torsoWarpParallelogram,
  fullBodyWarpParallelogram,
} from './pose-warp';

const TOP_POSE: PoseFrame = {
  timestampMs: 1,
  confidence: 0.9,
  keypoints: [
    { name: 'LEFT_SHOULDER', x: 0.35, y: 0.3, z: null, confidence: 0.9 },
    { name: 'RIGHT_SHOULDER', x: 0.65, y: 0.3, z: null, confidence: 0.9 },
    { name: 'LEFT_HIP', x: 0.4, y: 0.6, z: null, confidence: 0.85 },
    { name: 'RIGHT_HIP', x: 0.6, y: 0.6, z: null, confidence: 0.85 },
  ],
};

const LOWER_POSE: PoseFrame = {
  timestampMs: 2,
  confidence: 0.9,
  keypoints: [
    { name: 'LEFT_HIP', x: 0.4, y: 0.55, z: null, confidence: 0.9 },
    { name: 'RIGHT_HIP', x: 0.6, y: 0.55, z: null, confidence: 0.9 },
    { name: 'LEFT_ANKLE', x: 0.42, y: 0.92, z: null, confidence: 0.85 },
    { name: 'RIGHT_ANKLE', x: 0.58, y: 0.92, z: null, confidence: 0.85 },
  ],
};

describe('pose-warp parallelograms', () => {
  it('builds a torso parallelogram from real shoulder/hip geometry', () => {
    const geometry = deriveBodyGeometry(TOP_POSE);
    expect(geometry).not.toBeNull();
    const quad = torsoWarpParallelogram(geometry!);
    expect(quad).not.toBeNull();
    expect(quad!.topLeft.x).toBeLessThan(quad!.topRight.x);
    expect(quad!.topLeft.y).toBeLessThan(quad!.bottomLeft.y);
  });

  it('builds a lower-body parallelogram from hip/ankle geometry', () => {
    const lower = deriveLowerBodyGeometry(LOWER_POSE);
    expect(lower).not.toBeNull();
    expect(lower!.hipWidth).toBeCloseTo(0.2);
    expect(lower!.legLength).toBeGreaterThan(0.3);
    const quad = lowerBodyWarpParallelogram(lower!);
    expect(quad).not.toBeNull();
    expect(quad!.bottomLeft.y).toBeGreaterThan(quad!.topLeft.y);
  });

  it('falls back to knees when ankles are missing', () => {
    const kneeOnly: PoseFrame = {
      timestampMs: 3,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_HIP', x: 0.4, y: 0.55, z: null, confidence: 0.9 },
        { name: 'RIGHT_HIP', x: 0.6, y: 0.55, z: null, confidence: 0.9 },
        { name: 'LEFT_KNEE', x: 0.42, y: 0.75, z: null, confidence: 0.85 },
        { name: 'RIGHT_KNEE', x: 0.58, y: 0.75, z: null, confidence: 0.85 },
      ],
    };
    const lower = deriveLowerBodyGeometry(kneeOnly);
    expect(lower).not.toBeNull();
    expect(lower!.legLength).toBeGreaterThan(0.15);
  });

  it('does not invent lower geometry without hips', () => {
    expect(
      deriveLowerBodyGeometry({
        timestampMs: 4,
        confidence: 1,
        keypoints: [
          { name: 'LEFT_ANKLE', x: 0.4, y: 0.9, z: null, confidence: 0.9 },
          { name: 'RIGHT_ANKLE', x: 0.6, y: 0.9, z: null, confidence: 0.9 },
        ],
      }),
    ).toBeNull();
  });
});

describe('drawImageInParallelogram', () => {
  it('maps the unit square onto the parallelogram (does not double-scale by edge length)', () => {
    const geometry = deriveBodyGeometry(TOP_POSE);
    expect(geometry).not.toBeNull();
    const quad = torsoWarpParallelogram(geometry!);
    expect(quad).not.toBeNull();

    const canvasWidth = 1000;
    const canvasHeight = 1000;
    const tl = {
      x: quad!.topLeft.x * canvasWidth,
      y: quad!.topLeft.y * canvasHeight,
    };
    const tr = {
      x: quad!.topRight.x * canvasWidth,
      y: quad!.topRight.y * canvasHeight,
    };
    const bl = {
      x: quad!.bottomLeft.x * canvasWidth,
      y: quad!.bottomLeft.y * canvasHeight,
    };

    let transform: number[] | null = null;
    let drawArgs: unknown[] | null = null;
    const context = {
      save: () => undefined,
      restore: () => undefined,
      setTransform: (...args: number[]) => {
        transform = args;
      },
      drawImage: (...args: unknown[]) => {
        drawArgs = args;
      },
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    const bitmap = { width: 200, height: 280 } as CanvasImageSource;
    const ok = drawImageInParallelogram(context, bitmap, quad!, canvasWidth, canvasHeight, 1);
    expect(ok).toBe(true);
    expect(transform).not.toBeNull();
    // a,b = top edge; c,d = left edge; e,f = top-left — unit square → parallelogram.
    expect(transform![0]).toBeCloseTo(tr.x - tl.x);
    expect(transform![1]).toBeCloseTo(tr.y - tl.y);
    expect(transform![2]).toBeCloseTo(bl.x - tl.x);
    expect(transform![3]).toBeCloseTo(bl.y - tl.y);
    expect(transform![4]).toBeCloseTo(tl.x);
    expect(transform![5]).toBeCloseTo(tl.y);
    // Destination must be the unit square. Drawing w×h here was the physical bug.
    expect(drawArgs).toEqual([bitmap, 0, 0, 200, 280, 0, 0, 1, 1]);
  });
});

describe('full-body warp', () => {
  it('places an abaya hem below the hips and wider than a churidar', () => {
    const geometry = deriveBodyGeometry(TOP_POSE);
    expect(geometry).not.toBeNull();
    const abaya = fullBodyOverlayDefaults('Abaya');
    const churidar = fullBodyOverlayDefaults('Churidar');
    const abayaQuad = fullBodyWarpParallelogram(geometry!, abaya ?? undefined);
    const churidarQuad = fullBodyWarpParallelogram(geometry!, churidar ?? undefined);
    const torso = torsoWarpParallelogram(geometry!);
    expect(abayaQuad).not.toBeNull();
    expect(churidarQuad).not.toBeNull();
    expect(torso).not.toBeNull();
    const hemY = (abayaQuad!.bottomLeft.y + abayaQuad!.bottomRight.y) / 2;
    expect(hemY).toBeGreaterThan(geometry!.hipCenter.y);
    expect(hemY).toBeGreaterThan((torso!.bottomLeft.y + torso!.bottomRight.y) / 2);
    const abayaHem = Math.abs(abayaQuad!.bottomRight.x - abayaQuad!.bottomLeft.x);
    const churidarHem = Math.abs(churidarQuad!.bottomRight.x - churidarQuad!.bottomLeft.x);
    expect(abayaHem).toBeGreaterThan(churidarHem);
  });
});
