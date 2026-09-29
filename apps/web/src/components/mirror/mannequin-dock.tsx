'use client';

import { useMemo, useState } from 'react';

import {
  buildMannequinSpec,
  colorHex,
  nextSize,
  nextView,
  type MannequinView,
} from '@mirrorfit/experience';
import { resolveFitCategory } from '@mirrorfit/tryon-core';

import { MannequinStage } from './mannequin-stage';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const;

/**
 * Local 3D controls for the mirror. Gestures only change this mannequin.
 * The live camera overlay is untouched.
 */
export function MannequinDock({
  category,
  colorName,
  sizeLabel,
  gesture,
}: {
  readonly category: string | null;
  readonly colorName: string | null;
  readonly sizeLabel: string | null;
  readonly gesture: { readonly id: number; readonly command: 'next-view' | 'next-size' } | null;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MannequinView>('front');
  const [rotation, setRotation] = useState(0);
  const [length, setLength] = useState(1);
  const [sleeve, setSleeve] = useState(1);
  const [waist, setWaist] = useState(1);
  const [size, setSize] = useState<string | null>(sizeLabel);
  const [seenSize, setSeenSize] = useState<string | null>(sizeLabel);
  const [lastGestureId, setLastGestureId] = useState<number | null>(null);
  if (sizeLabel !== seenSize) {
    setSeenSize(sizeLabel);
    setSize(sizeLabel);
  }
  if (open && gesture && gesture.id !== lastGestureId) {
    setLastGestureId(gesture.id);
    if (gesture.command === 'next-view') setView((current) => nextView(current));
    if (gesture.command === 'next-size') setSize((current) => nextSize(current, SIZES));
  }

  const spec = useMemo(
    () =>
      buildMannequinSpec({
        view,
        rotationDeg: rotation,
        fit: resolveFitCategory(category),
        colorHex: colorHex(colorName),
        size,
        length,
        sleeve,
        waist,
      }),
    [view, rotation, category, colorName, size, length, sleeve, waist],
  );

  return (
    <div className="w-full max-w-md space-y-3 text-left" data-testid="mannequin-dock">
      <button
        type="button"
        className="text-xs uppercase tracking-[0.25em] text-muted underline-offset-4 hover:text-secondary hover:underline"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? 'Hide 3D mannequin' : '3D mannequin'}
      </button>
      {open ? (
        <div className="space-y-3 rounded-lg bg-black/30 p-3">
          <p className="text-xs text-muted">
            Generic body for size and rotation. Not a photo, and not the live try-on.
          </p>
          <MannequinStage spec={spec} />
          <div className="flex flex-wrap gap-2">
            {(['front', 'side', 'back'] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-widest text-secondary"
                onClick={() => setView(entry)}
              >
                {entry}
              </button>
            ))}
          </div>
          <label className="block text-xs text-muted">
            Rotation {rotation}°
            <input
              className="mt-1 w-full"
              type="range"
              min={-180}
              max={180}
              value={rotation}
              onChange={(event) => setRotation(Number(event.target.value))}
            />
          </label>
          <label className="block text-xs text-muted">
            Length
            <input
              className="mt-1 w-full"
              type="range"
              min={80}
              max={125}
              value={Math.round(length * 100)}
              onChange={(event) => setLength(Number(event.target.value) / 100)}
            />
          </label>
          <label className="block text-xs text-muted">
            Sleeve
            <input
              className="mt-1 w-full"
              type="range"
              min={80}
              max={125}
              value={Math.round(sleeve * 100)}
              onChange={(event) => setSleeve(Number(event.target.value) / 100)}
            />
          </label>
          <label className="block text-xs text-muted">
            Waist
            <input
              className="mt-1 w-full"
              type="range"
              min={80}
              max={125}
              value={Math.round(waist * 100)}
              onChange={(event) => setWaist(Number(event.target.value) / 100)}
            />
          </label>
          <p className="text-xs text-muted">
            Size visualization {size ?? 'M'}. Raise one hand to change view, both hands to step
            size.
          </p>
        </div>
      ) : null}
    </div>
  );
}
