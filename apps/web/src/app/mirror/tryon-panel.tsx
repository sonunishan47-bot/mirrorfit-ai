'use client';

import { useEffect, useRef, useState } from 'react';

import {
  CameraFramePipeline,
  FrameRateCounter,
  LandmarkFittingEngine,
  OverlayRenderer,
  UnavailableSegmentationProvider,
  createTestFixtureShirtBitmap,
  deriveBodyGeometry,
  describePoseReadiness,
  formatPoseReadiness,
  overlaySourceForSelection,
  presentTryOn,
  reduceTryOn,
  resolveFitCategory,
  type CameraFrame,
  type PoseProvider,
} from '@mirrorfit/tryon-core';
import type { TryOnRuntimeStatus } from '@mirrorfit/types';

import { createKioskPoseProvider } from '@/lib/tryon/mediapipe-pose-provider';

/**
 * Phase 5 try-on runtime. Runs only while the Phase 4 session is ACTIVE.
 *
 * Pose uses official MediaPipe Pose Landmarker when it initializes.
 * Segmentation is still unavailable. Overlay is a labelled test-fixture
 * shirt placed from real landmarks — not a product photograph.
 *
 * Pose initialize/dispose is tied to `active` only. Garment changes do not
 * reload the model.
 */
export function TryOnPanel({
  active,
  getFrame,
  selectedGarment,
  selectedCategory,
  selectedIsTestFixture = false,
}: {
  active: boolean;
  getFrame: () => CameraFrame | null;
  selectedGarment: { garmentId: string; variantId: string } | null;
  selectedCategory?: string | null;
  selectedIsTestFixture?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const getFrameRef = useRef(getFrame);
  const garmentRef = useRef({ selectedGarment, selectedCategory, selectedIsTestFixture });
  const statusRef = useRef<TryOnRuntimeStatus>('CAMERA_READY');
  const [status, setStatus] = useState<TryOnRuntimeStatus>('CAMERA_READY');
  const [reason, setReason] = useState<string | null>(null);
  const [poseFps, setPoseFps] = useState<number | null>(null);
  const [dropped, setDropped] = useState(0);
  const [poseHint, setPoseHint] = useState<string | null>(null);
  const view = presentTryOn(status);

  useEffect(() => {
    getFrameRef.current = getFrame;
    garmentRef.current = { selectedGarment, selectedCategory, selectedIsTestFixture };
  }, [getFrame, selectedGarment, selectedCategory, selectedIsTestFixture]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const segmentation = new UnavailableSegmentationProvider();
    const fitting = new LandmarkFittingEngine();
    const renderer = new OverlayRenderer();
    const poseFpsCounter = new FrameRateCounter();
    const fixtureBitmap = createTestFixtureShirtBitmap();
    const canvas = canvasRef.current;
    if (canvas) {
      renderer.attach(canvas);
    }

    let disposed = false;
    let pose: PoseProvider | null = null;
    let pipeline: CameraFramePipeline | null = null;
    let lastGarmentKey = '';

    const move = (event: Parameters<typeof reduceTryOn>[1]) => {
      if (disposed) return;
      const next = reduceTryOn(statusRef.current, event);
      if (next !== statusRef.current) {
        setStatus(next);
      }
    };

    const noteReason = (next: string | null) => {
      if (disposed) return;
      setReason((current) => (current === next ? current : next));
    };

    function currentOverlaySource() {
      const current = garmentRef.current;
      return overlaySourceForSelection({
        selected: current.selectedGarment !== null,
        isTestFixture: current.selectedIsTestFixture,
        fitCategory: resolveFitCategory(current.selectedCategory),
      });
    }

    function applyOverlaySource(): void {
      renderer.setOverlay(currentOverlaySource() === 'test_fixture' ? fixtureBitmap : null);
    }

    async function syncGarment(): Promise<void> {
      const current = garmentRef.current;
      const key = current.selectedGarment
        ? `${current.selectedGarment.garmentId}:${current.selectedGarment.variantId}:${current.selectedCategory ?? ''}:${current.selectedIsTestFixture}`
        : '';
      if (key === lastGarmentKey) return;
      lastGarmentKey = key;
      applyOverlaySource();
      if (!current.selectedGarment) {
        fitting.clearGarment();
        move('GARMENT_CLEARED');
        return;
      }
      await fitting.loadGarment(
        current.selectedGarment.garmentId,
        current.selectedGarment.variantId,
        current.selectedCategory ?? null,
      );
      if (disposed) return;
      move('GARMENT_CHOSEN');
    }

    void (async () => {
      move('POSE_START');
      try {
        pose = await createKioskPoseProvider();
        await segmentation.initialize();
        await fitting.initialize();
        if (canvas) {
          await renderer.initialize({ width: canvas.width || 1, height: canvas.height || 1 });
        }
        if (disposed) {
          await pose.dispose();
          return;
        }

        if (pose.availability !== 'ready') {
          noteReason(pose.lastError ?? 'Pose model failed to initialize.');
          move('PROVIDER_MISSING');
          return;
        }
        noteReason(null);
        move('POSE_READY');
        await syncGarment();
        if (disposed) return;

        pipeline = new CameraFramePipeline(
          {
            readFrame: () => getFrameRef.current(),
            process: async (frame) => {
              if (disposed || !pose) return;
              try {
                await syncGarment();
                if (disposed || !pose) return;
                const landmarks = await pose.processFrame(frame);
                if (disposed) return;
                const selected = garmentRef.current.selectedGarment;

                if (landmarks) {
                  poseFpsCounter.tick(frame.timestampMs);
                  const fps = poseFpsCounter.fps();
                  setPoseFps((current) =>
                    current === null || fps === null || Math.abs(current - fps) > 1 ? fps : current,
                  );
                  const hint = formatPoseReadiness(describePoseReadiness(landmarks));
                  setPoseHint((current) => (current === hint ? current : hint));
                  move('PERSON_SEEN');
                } else {
                  setPoseHint((current) => (current === null ? current : null));
                  move('PERSON_LOST');
                }

                const geometry = landmarks ? deriveBodyGeometry(landmarks) : null;
                if (selected && landmarks && geometry) {
                  const fit = await fitting.fit({
                    pose: landmarks,
                    geometry,
                    segmentation: null,
                    depth: null,
                  });
                  if (disposed) return;
                  const drawable = currentOverlaySource() === 'test_fixture';
                  if (fitting.lastStatus === 'lower_body_not_implemented') {
                    noteReason('LOWER BODY FITTING NOT IMPLEMENTED');
                    move('FIT_NOT_READY');
                  } else if (fit && drawable) {
                    noteReason(null);
                    move('FIT_READY');
                  } else if (fit && !drawable) {
                    noteReason('No drawable garment overlay asset is available.');
                    move('FIT_NOT_READY');
                  } else {
                    move('FIT_NOT_READY');
                  }
                  if (canvas && frame.width > 0 && frame.height > 0) {
                    renderer.resize({ width: frame.width, height: frame.height });
                  }
                  await renderer.render(frame, fit && drawable ? fit : null);
                } else {
                  if (canvas && frame.width > 0 && frame.height > 0) {
                    renderer.resize({ width: frame.width, height: frame.height });
                  }
                  await renderer.render(frame, null);
                  if (selected && !geometry) {
                    move('FIT_NOT_READY');
                  }
                }

                if (disposed) return;
                if (pipeline && pipeline.droppedWhileBusy > 0) {
                  setDropped((current) =>
                    current === pipeline!.droppedWhileBusy ? current : pipeline!.droppedWhileBusy,
                  );
                }
              } catch (error) {
                if (disposed) return;
                noteReason(
                  error instanceof Error ? error.message.slice(0, 120) : 'Pose processing failed.',
                );
                move('FIT_NOT_READY');
              }
            },
          },
          8,
        );
        pipeline.start();
      } catch (error) {
        if (disposed) return;
        noteReason(
          error instanceof Error ? error.message.slice(0, 200) : 'Pose model failed to initialize.',
        );
        move('PROVIDER_MISSING');
      }
    })();

    return () => {
      disposed = true;
      void pipeline?.dispose();
      void pose?.dispose();
      void segmentation.dispose();
      void fitting.dispose();
      void renderer.dispose();
    };
  }, [active]);

  if (!active) {
    return null;
  }

  const family = resolveFitCategory(selectedCategory);
  const overlayKind = overlaySourceForSelection({
    selected: selectedGarment !== null,
    isTestFixture: selectedIsTestFixture,
    fitCategory: family,
  });
  const layer =
    status === 'PREVIEW'
      ? 'POSE + FITTING'
      : status === 'FITTING'
        ? 'FITTING'
        : status === 'POSE_READY'
          ? 'POSE READY'
          : status === 'NO_PERSON_DETECTED'
            ? 'NO PERSON DETECTED'
            : status === 'FIT_NOT_READY'
              ? 'FIT NOT READY'
              : status === 'PROVIDER_UNAVAILABLE'
                ? 'POSE PROVIDER UNAVAILABLE'
                : status === 'POSE_INITIALIZING'
                  ? 'POSE INITIALIZING'
                  : view.label;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-[1] size-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
        aria-hidden
      />
      <p className="max-w-md text-sm text-muted" data-testid="tryon-status">
        {layer}. {view.honesty}
        {reason ? ` ${reason}` : ''}
        {selectedGarment
          ? family === 'LOWER_BODY'
            ? ' LOWER BODY FITTING NOT IMPLEMENTED.'
            : overlayKind === 'test_fixture'
              ? ' TEST FIXTURE overlay only — NOT A COMMERCIAL PRODUCT — NOT A PHOTOGRAPHIC AI TRY-ON.'
              : ' No drawable garment overlay asset is available.'
          : ' No garment is selected.'}
        {poseHint ? ` ${poseHint}` : ''}
        {poseFps !== null ? ` Pose ${poseFps.toFixed(0)} fps.` : ''}
        {dropped > 0 ? ` Dropped ${dropped} busy frames.` : ''}
        {' Segmentation unavailable.'}
      </p>
    </>
  );
}
