'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  AsyncTryOnQueue,
  CameraFramePipeline,
  FrameRateCounter,
  LandmarkFittingEngine,
  OverlayBitmapCache,
  OverlayLoadGuard,
  OverlayRenderer,
  PHOTOREALISTIC_UNAVAILABLE_REASON,
  TEST_FIXTURE_OVERLAY_LAYOUT,
  TEST_FIXTURE_PANTS_LAYOUT,
  UnavailablePhotorealisticTryOnProvider,
  UnavailableSegmentationProvider,
  computeOverlayOpacity,
  createTestFixturePantsBitmap,
  createTestFixtureShirtBitmap,
  deriveBodyGeometry,
  deriveLowerBodyGeometry,
  describePoseReadiness,
  formatPoseReadiness,
  loadOverlayBitmap,
  lowerBodyWarpParallelogram,
  lowerOverlayDefaults,
  overlaySourceForSelection,
  presentTryOn,
  reduceTryOn,
  resolveFitCategory,
  topOverlayDefaults,
  torsoWarpParallelogram,
  type CameraFrame,
  type OverlayLayout,
  type PoseProvider,
  type WarpParallelogram,
} from '@mirrorfit/tryon-core';
import type { TryOnRuntimeStatus } from '@mirrorfit/types';

import { loadDeviceCredential } from '@/lib/device/store';
import { fetchGarmentOverlay } from '@/lib/tryon/garment-overlay-client';
import { createKioskPoseProvider } from '@/lib/tryon/mediapipe-pose-provider';

/**
 * Try-on runtime. Runs only while the session is ACTIVE.
 *
 * Pose uses official MediaPipe Pose Landmarker when it initializes.
 * Segmentation is still unavailable. Photorealistic / diffusion try-on is
 * honestly unavailable (no frame upload, no on-device model) — the kiosk
 * falls back to pose-geometry / pose-warp overlays.
 *
 * Pose initialize/dispose is tied to `active` only. Garment changes do not
 * reload the model. Overlay loads use a generation guard so rapid phone
 * category/garment changes never race.
 */
export function TryOnPanel({
  active,
  getFrame,
  selectedGarment,
  selectedCategory,
  selectedIsTestFixture = false,
  onPresenceChange,
  /** Full-bleed host above the camera (and above the dim scrim). */
  overlayRoot = null,
}: {
  active: boolean;
  getFrame: () => CameraFrame | null;
  selectedGarment: { garmentId: string; variantId: string } | null;
  selectedCategory?: string | null;
  selectedIsTestFixture?: boolean;
  /** Optional wake signal for kiosk power-save — person seen / lost only. */
  onPresenceChange?: (present: boolean) => void;
  overlayRoot?: HTMLElement | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const getFrameRef = useRef(getFrame);
  const garmentRef = useRef({ selectedGarment, selectedCategory, selectedIsTestFixture });
  const presenceRef = useRef(onPresenceChange);
  const statusRef = useRef<TryOnRuntimeStatus>('CAMERA_READY');
  const [status, setStatus] = useState<TryOnRuntimeStatus>('CAMERA_READY');
  const [reason, setReason] = useState<string | null>(null);
  const [poseFps, setPoseFps] = useState<number | null>(null);
  const [dropped, setDropped] = useState(0);
  const [poseHint, setPoseHint] = useState<string | null>(null);
  const [hasOverlayAsset, setHasOverlayAsset] = useState(false);
  const view = presentTryOn(status);

  useEffect(() => {
    getFrameRef.current = getFrame;
    garmentRef.current = { selectedGarment, selectedCategory, selectedIsTestFixture };
    presenceRef.current = onPresenceChange;
  }, [getFrame, selectedGarment, selectedCategory, selectedIsTestFixture, onPresenceChange]);

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
    const photorealistic = new UnavailablePhotorealisticTryOnProvider();
    const tryOnQueue = new AsyncTryOnQueue(2_500);
    const poseFpsCounter = new FrameRateCounter();
    const shirtFixture = createTestFixtureShirtBitmap();
    const pantsFixture = createTestFixturePantsBitmap();
    const overlayCache = new OverlayBitmapCache(8);
    const loadGuard = new OverlayLoadGuard();
    const canvas = canvasRef.current;
    if (canvas) {
      renderer.attach(canvas);
    }

    let disposed = false;
    let pose: PoseProvider | null = null;
    let pipeline: CameraFramePipeline | null = null;
    let lastGarmentKey = '';
    let overlayLoaded = false;

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
        hasOverlayAsset: overlayLoaded,
      });
    }

    function applyCategoryDefaults(category: string | null | undefined): void {
      const family = resolveFitCategory(category);
      if (family === 'TOP') {
        fitting.setWidthFactor(topOverlayDefaults(category)?.widthFactor ?? null);
        return;
      }
      if (family === 'LOWER_BODY') {
        fitting.setWidthFactor(lowerOverlayDefaults(category)?.widthFactor ?? null);
        return;
      }
      fitting.setWidthFactor(null);
    }

    function applyFixtureOverlay(family: 'TOP' | 'LOWER_BODY'): void {
      loadGuard.begin();
      if (family === 'LOWER_BODY') {
        fitting.setAnchorMode('hips');
        applyCategoryDefaults(garmentRef.current.selectedCategory);
        renderer.setOverlay(pantsFixture, TEST_FIXTURE_PANTS_LAYOUT);
      } else {
        fitting.setAnchorMode('shoulders');
        applyCategoryDefaults(garmentRef.current.selectedCategory);
        renderer.setOverlay(shirtFixture, TEST_FIXTURE_OVERLAY_LAYOUT);
      }
      overlayLoaded = true;
      setHasOverlayAsset(true);
      noteReason(null);
    }

    function clearOverlay(): void {
      loadGuard.begin();
      tryOnQueue.cancel();
      fitting.setAnchorMode('center');
      fitting.setWidthFactor(null);
      renderer.setOverlay(null);
      overlayLoaded = false;
      setHasOverlayAsset(false);
    }

    async function applyCatalogOverlay(
      garmentId: string,
      variantId: string,
      category: string | null | undefined,
      family: 'TOP' | 'LOWER_BODY',
    ): Promise<boolean> {
      const token = loadGuard.begin();
      const secret = loadDeviceCredential()?.deviceSecret ?? null;
      if (!secret) {
        if (loadGuard.isCurrent(token)) clearOverlay();
        return false;
      }

      noteReason('Loading garment overlay…');
      const meta = await fetchGarmentOverlay(secret, garmentId, variantId);
      if (!loadGuard.isCurrent(token) || disposed) return false;
      if (!meta) {
        clearOverlay();
        noteReason('No drawable garment overlay asset is available.');
        return false;
      }

      const defaults =
        family === 'TOP' ? topOverlayDefaults(category) : lowerOverlayDefaults(category);
      let entry = overlayCache.get(meta.content_hash);
      if (!entry) {
        const loaded = await loadOverlayBitmap(meta.overlay_url, {
          expectedContentHash: meta.content_hash,
        });
        if (!loadGuard.isCurrent(token) || disposed) {
          if (loaded && 'close' in loaded.bitmap) {
            (loaded.bitmap as ImageBitmap).close?.();
          }
          return false;
        }
        if (!loaded) {
          clearOverlay();
          noteReason('No drawable garment overlay asset is available.');
          return false;
        }
        entry = { bitmap: loaded.bitmap, width: loaded.width, height: loaded.height };
        overlayCache.set(meta.content_hash, entry);
      }

      if (!loadGuard.isCurrent(token) || disposed) return false;

      const layout: OverlayLayout = {
        anchor:
          meta.anchor ??
          defaults?.anchor ??
          (family === 'LOWER_BODY' ? { x: 0.5, y: 0.08 } : { x: 0.5, y: 0.22 }),
        aspectRatio: entry.width / entry.height,
      };
      fitting.setAnchorMode(family === 'LOWER_BODY' ? 'hips' : 'shoulders');
      fitting.setWidthFactor(defaults?.widthFactor ?? null);
      renderer.setOverlay(entry.bitmap, layout);
      overlayLoaded = true;
      setHasOverlayAsset(true);
      noteReason(null);
      return true;
    }

    /**
     * Probe the photorealistic provider asynchronously. Always null today —
     * never replaces the geometric overlay with a decorative stand-in.
     * Timeout / cancel leaves the pose-geometry path unchanged.
     */
    function probePhotorealisticFallback(): void {
      const current = garmentRef.current;
      if (!current.selectedGarment) return;
      void tryOnQueue.enqueue(async (signal) => {
        if (signal.cancelled || disposed) return null;
        const result = await photorealistic.generate({
          frame: {
            timestampMs: Date.now(),
            width: 1,
            height: 1,
            source: shirtFixture,
          },
          fit: {
            timestampMs: Date.now(),
            confidence: 0,
            transform: {
              translate: { x: 0.5, y: 0.5 },
              scaleX: 0,
              scaleY: 0,
              rotation: 0,
            },
          },
          garmentId: current.selectedGarment!.garmentId,
          variantId: current.selectedGarment!.variantId,
        });
        if (signal.cancelled || disposed) return null;
        if (result === null && photorealistic.availability === 'unavailable') {
          // Geometric overlay already active — keep it.
          return null;
        }
        return result;
      });
    }

    async function syncGarment(): Promise<void> {
      const current = garmentRef.current;
      const key = current.selectedGarment
        ? `${current.selectedGarment.garmentId}:${current.selectedGarment.variantId}:${current.selectedCategory ?? ''}:${current.selectedIsTestFixture}`
        : '';
      if (key === lastGarmentKey) return;
      lastGarmentKey = key;

      if (!current.selectedGarment) {
        clearOverlay();
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

      const fitCategory = resolveFitCategory(current.selectedCategory);
      if (fitCategory !== 'TOP' && fitCategory !== 'LOWER_BODY') {
        clearOverlay();
        move('GARMENT_CHOSEN');
        return;
      }

      if (current.selectedIsTestFixture) {
        applyFixtureOverlay(fitCategory);
      } else {
        await applyCatalogOverlay(
          current.selectedGarment.garmentId,
          current.selectedGarment.variantId,
          current.selectedCategory,
          fitCategory,
        );
        if (disposed) return;
      }

      probePhotorealisticFallback();
      move('GARMENT_CHOSEN');
    }

    void (async () => {
      move('POSE_START');
      try {
        pose = await createKioskPoseProvider();
        await segmentation.initialize();
        await fitting.initialize();
        await photorealistic.initialize();
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
                const category = garmentRef.current.selectedCategory;
                const family = resolveFitCategory(category);

                if (landmarks) {
                  poseFpsCounter.tick(frame.timestampMs);
                  const fps = poseFpsCounter.fps();
                  setPoseFps((current) =>
                    current === null || fps === null || Math.abs(current - fps) > 1 ? fps : current,
                  );
                  const hint = formatPoseReadiness(describePoseReadiness(landmarks));
                  setPoseHint((current) => (current === hint ? current : hint));
                  move('PERSON_SEEN');
                  presenceRef.current?.(true);
                } else {
                  // Person lost — drop any held overlay so we do not freeze a ghost shirt.
                  fitting.clearHeldFit();
                  setPoseHint((current) => (current === null ? current : null));
                  move('PERSON_LOST');
                  presenceRef.current?.(false);
                }

                const geometry = landmarks ? deriveBodyGeometry(landmarks) : null;
                const lowerGeometry =
                  landmarks && family === 'LOWER_BODY'
                    ? deriveLowerBodyGeometry(landmarks)
                    : null;
                const geometryReady =
                  family === 'LOWER_BODY' ? lowerGeometry !== null : geometry !== null;

                // Call fit whenever a person + garment are present so the engine's
                // hold/hysteresis can keep the shirt up across brief weak frames.
                if (selected && landmarks) {
                  const fit = await fitting.fit({
                    pose: landmarks,
                    geometry,
                    segmentation: null,
                    depth: null,
                  });
                  if (disposed) return;
                  const source = currentOverlaySource();
                  const drawable = source === 'test_fixture' || source === 'catalog_overlay';
                  if (fit && drawable) {
                    noteReason(null);
                    move('FIT_READY');
                  } else if (fit && !drawable) {
                    noteReason('No drawable garment overlay asset is available.');
                    move('FIT_NOT_READY');
                  } else if (!geometryReady) {
                    move('FIT_NOT_READY');
                  } else {
                    move('FIT_NOT_READY');
                  }
                  if (canvas && frame.width > 0 && frame.height > 0) {
                    renderer.resize({ width: frame.width, height: frame.height });
                  }
                  let warp: WarpParallelogram | null = null;
                  if (drawable && family === 'TOP' && geometry) {
                    warp = torsoWarpParallelogram(geometry);
                  } else if (drawable && family === 'LOWER_BODY' && lowerGeometry) {
                    warp = lowerBodyWarpParallelogram(lowerGeometry);
                  }
                  const occlusionGeometry =
                    geometry ??
                    (lowerGeometry
                      ? {
                          timestampMs: landmarks.timestampMs,
                          shoulderWidth: lowerGeometry.hipWidth,
                          hipWidth: lowerGeometry.hipWidth,
                          torsoHeight: lowerGeometry.legLength,
                          roll: lowerGeometry.hipRoll,
                          yaw: 0,
                          shoulderCenter: lowerGeometry.hipCenter,
                          hipCenter: lowerGeometry.hipCenter,
                          center: lowerGeometry.hipCenter,
                        }
                      : null);
                  const occlusion = occlusionGeometry
                    ? computeOverlayOpacity({
                        geometry: occlusionGeometry,
                        poseConfidence: fit?.confidence ?? landmarks.confidence,
                        regions: segmentation.readRegions(frame.timestampMs),
                      })
                    : {
                        overlayOpacity: Math.min(
                          1,
                          Math.max(0, fit?.confidence ?? landmarks.confidence),
                        ),
                      };
                  await renderer.render(frame, fit && drawable ? fit : null, {
                    opacity: fit && drawable ? occlusion.overlayOpacity : 0,
                    yaw: geometry?.yaw ?? 0,
                    warp,
                  });
                } else {
                  if (canvas && frame.width > 0 && frame.height > 0) {
                    renderer.resize({ width: frame.width, height: frame.height });
                  }
                  await renderer.render(frame, null);
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
      loadGuard.invalidate();
      tryOnQueue.cancel();
      overlayCache.clear();
      void pipeline?.dispose();
      void pose?.dispose();
      void segmentation.dispose();
      void fitting.dispose();
      void photorealistic.dispose();
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
    hasOverlayAsset,
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

  const overlayCanvas = (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 size-full bg-transparent object-cover"
      style={{ transform: 'scaleX(-1)', backgroundColor: 'transparent' }}
      aria-hidden
      data-testid="tryon-overlay-canvas"
    />
  );

  return (
    <>
      {overlayRoot ? createPortal(overlayCanvas, overlayRoot) : overlayCanvas}
      <p className="relative z-[2] max-w-md text-sm text-muted" data-testid="tryon-status">
        {layer}. {view.honesty}
        {reason ? ` ${reason}` : ''}
        {selectedGarment
          ? overlayKind === 'test_fixture'
            ? ` TEST FIXTURE ${family === 'LOWER_BODY' ? 'pants' : 'shirt'} overlay only — NOT A COMMERCIAL PRODUCT — NOT A PHOTOGRAPHIC AI TRY-ON.`
            : overlayKind === 'catalog_overlay'
              ? ' Commercial overlay from shop catalog — pose-geometry / pose-warp placement, not photorealistic try-on.'
              : ' No drawable garment overlay asset is available.'
          : ' No garment is selected.'}
        {` ${PHOTOREALISTIC_UNAVAILABLE_REASON}`}
        {poseHint ? ` ${poseHint}` : ''}
        {poseFps !== null ? ` Pose ${poseFps.toFixed(0)} fps.` : ''}
        {dropped > 0 ? ` Dropped ${dropped} busy frames.` : ''}
        {' Segmentation unavailable.'}
      </p>
    </>
  );
}
