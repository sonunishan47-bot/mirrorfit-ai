import type { GarmentFitCategory } from '@mirrorfit/types';

import { sizeScale } from './advice';

export type MannequinView = 'front' | 'side' | 'back';

export interface MannequinSpec {
  readonly yaw: number;
  readonly camera: { readonly x: number; readonly y: number; readonly z: number };
  readonly garment: GarmentFitCategory | 'NONE';
  readonly garmentColor: string;
  readonly length: number;
  readonly sleeve: number;
  readonly waist: number;
  readonly scale: number;
}

const VIEWS: Readonly<Record<MannequinView, { x: number; y: number; z: number }>> = {
  front: { x: 0, y: 1.15, z: 3.4 },
  side: { x: 3.4, y: 1.15, z: 0.15 },
  back: { x: 0, y: 1.15, z: -3.4 },
};

export function clampControl(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1.25, Math.max(0.8, value));
}

export function buildMannequinSpec(input: {
  readonly view: MannequinView;
  readonly rotationDeg: number;
  readonly fit: GarmentFitCategory | null;
  readonly colorHex: string | null;
  readonly size: string | null;
  readonly length: number;
  readonly sleeve: number;
  readonly waist: number;
}): MannequinSpec {
  const rotation = Number.isFinite(input.rotationDeg) ? input.rotationDeg : 0;
  return {
    yaw: (rotation * Math.PI) / 180,
    camera: VIEWS[input.view],
    garment: input.fit ?? 'NONE',
    garmentColor: /^#[0-9a-fA-F]{6}$/.test(input.colorHex ?? '') ? input.colorHex! : '#1f3d32',
    length: clampControl(input.length),
    sleeve: clampControl(input.sleeve),
    waist: clampControl(input.waist),
    scale: sizeScale(input.size),
  };
}

export function nextView(view: MannequinView): MannequinView {
  if (view === 'front') return 'side';
  if (view === 'side') return 'back';
  return 'front';
}

/**
 * Image Y grows downward. A wrist clearly above its shoulder is a raise.
 * One hand changes the mannequin view. Both hands step the size visualization.
 * This does not change the live 2D garment overlay.
 */
export function gestureFromJoints(joints: {
  readonly leftWristY: number | null;
  readonly rightWristY: number | null;
  readonly leftShoulderY: number | null;
  readonly rightShoulderY: number | null;
}): 'next-view' | 'next-size' | null {
  const raised = (wrist: number | null, shoulder: number | null) =>
    wrist !== null &&
    shoulder !== null &&
    Number.isFinite(wrist) &&
    Number.isFinite(shoulder) &&
    wrist < shoulder - 0.08;
  const left = raised(joints.leftWristY, joints.leftShoulderY);
  const right = raised(joints.rightWristY, joints.rightShoulderY);
  if (left && right) return 'next-size';
  if (left || right) return 'next-view';
  return null;
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const;

export function nextSize(current: string | null, available: readonly string[]): string | null {
  const labels = (available.length > 0 ? available : SIZE_ORDER).filter((label) =>
    SIZE_ORDER.some((known) => known === label),
  );
  if (labels.length === 0) return current;
  const index = current ? labels.indexOf(current) : -1;
  return labels[(index + 1) % labels.length] ?? labels[0] ?? null;
}
