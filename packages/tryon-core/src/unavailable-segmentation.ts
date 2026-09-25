import type { BodyRegionName } from '@mirrorfit/types';

import type { CameraFrame, SegmentationMask, SegmentationProvider } from './providers';

export type BodyRegionSource = 'unavailable' | 'segmentation' | 'pose_derived';

export interface BodyRegionObservation {
  readonly region: BodyRegionName;
  readonly available: boolean;
  readonly confidence: number | null;
}

export interface BodyRegionMap {
  readonly timestampMs: number;
  readonly source: BodyRegionSource;
  readonly regions: readonly BodyRegionObservation[];
}

const REGIONS = ['UPPER_BODY', 'LOWER_BODY', 'ARMS', 'HANDS', 'TORSO', 'LEGS'] as const;

/**
 * STATUS: PROVIDER UNAVAILABLE.
 *
 * Does not invent a person mask. A later real segmenter can implement
 * `SegmentationProvider` and populate `BodyRegionMap` from actual pixels.
 */
export class UnavailableSegmentationProvider implements SegmentationProvider {
  readonly name = 'unavailable';
  readonly availability = 'unavailable' as const;
  readonly lastError =
    'Official MediaPipe selfie segmenters expose person/background (or hair/skin/clothes), not torso/arms/lower-body regions. No verified region model is integrated.';

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  segment(_frame: CameraFrame): Promise<SegmentationMask | null> {
    return Promise.resolve(null);
  }

  readRegions(timestampMs: number): BodyRegionMap {
    return unavailableBodyRegions(timestampMs);
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

export function unavailableBodyRegions(timestampMs: number): BodyRegionMap {
  return {
    timestampMs,
    source: 'unavailable',
    regions: REGIONS.map((region) => ({
      region,
      available: false,
      confidence: null,
    })),
  };
}
