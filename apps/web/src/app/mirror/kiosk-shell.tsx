'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { FrameRateCounter, resolveFitCategory } from '@mirrorfit/tryon-core';

import { ClientErrorBoundary } from '@/components/client-error-boundary';
import { MannequinDock } from '@/components/mirror/mannequin-dock';
import { BrowserCameraProvider, describeCameraStartError } from '@/lib/camera/browser-camera';
import { resolveCameraPresence } from '@/lib/camera/camera-presence';
import {
  TRIAL_PANTS_OVERLAY,
  TRIAL_SHIRT_OVERLAY,
  type TrialOverlaySelection,
} from '@/lib/catalog/trial-overlay';
import { startHeartbeatLoop } from '@/lib/device/heartbeat-loop';
import {
  clearDeviceCredential,
  deviceCredentialServerSnapshot,
  deviceCredentialSnapshot,
  loadDeviceCredential,
  saveDeviceCredential,
  subscribeDeviceCredential,
} from '@/lib/device/store';
import { noteCameraFrame } from '@/lib/kiosk/fps';
import { KioskAnalyticsBuffer } from '@/lib/kiosk/kiosk-analytics';
import { presentKiosk, reduceKiosk, type KioskStatus } from '@/lib/kiosk/machine';
import { pairingQrValue } from '@/lib/kiosk/pairing-qr';
import {
  createPollResilienceState,
  notePollFailure,
  notePollSuccess,
  shouldForcePollOnReconnect,
  type PollResilienceState,
} from '@/lib/kiosk/poll-resilience';
import {
  DEFAULT_POWER_SAVE_IDLE_MS,
  evaluatePowerSave,
  shouldRunTryOnPipeline,
  shouldShowScreensaver,
  type PowerSavePhase,
} from '@/lib/kiosk/power-save';
import {
  activateKioskSession,
  createKioskSession,
  endKioskSession,
  enrollDevice,
  readLiveSession,
} from '@/lib/kiosk/session-client';
import { createSessionLifecycle } from '@/lib/kiosk/session-lifecycle';
import { kioskSessionPollMs } from '@/lib/kiosk/session-poll';
import { KioskScreensaver } from './kiosk-screensaver';
import { LucyClipStage } from './lucy-clip-stage';
import { TryOnPanel } from './tryon-panel';
import { UnenrolledPanel } from './unenrolled-panel';

const CAMERA_CONSTRAINTS = { width: 1920, height: 1080, frameRate: 30 } as const;
/** Must exceed BrowserCameraProvider playTimeoutMs so play can finish first. */
const CAMERA_START_MS = 12_000;
const RESET_MS = 1600;
const POWER_SAVE_TICK_MS = 1_000;
/** While power-saving, FPS sample pump runs at a low cadence instead of every RAF. */
const POWER_SAVE_FPS_MS = 2_000;

type CameraStatus = 'starting' | 'live' | 'unavailable';

/**
 * Live kiosk: enrolled device, heartbeat, real session, real pairing QR.
 *
 * Camera frames stay in the local `<video>` element. The QR encodes only
 * `/s?t=…`. The device secret is read from local persistence and sent as a
 * bearer header; it is never rendered.
 *
 * Session open / poll / end races are owned by `createSessionLifecycle`
 * (generation epoch). Effects here only wire HTTP and React state.
 *
 * Power-save is orthogonal to the session machine: after prolonged inactivity
 * MediaPipe try-on pauses and a branded screensaver covers the glass until
 * a claim, presence, or pointer wake.
 */
export function KioskShell() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<BrowserCameraProvider | null>(null);
  const fpsRef = useRef(new FrameRateCounter());
  const statusRef = useRef<KioskStatus>('IDLE');
  const lifecycleRef = useRef(createSessionLifecycle());
  const analyticsRef = useRef(new KioskAnalyticsBuffer());
  const pollResilienceRef = useRef<PollResilienceState>(createPollResilienceState());
  const lastActivityRef = useRef(Date.now());
  const powerPhaseRef = useRef<PowerSavePhase>('awake');
  const prevGarmentKeyRef = useRef<string>('');
  const prevStatusRef = useRef<KioskStatus>('IDLE');
  const [pollHealth, setPollHealth] = useState<'ok' | 'degraded'>('ok');

  const device = useSyncExternalStore(
    subscribeDeviceCredential,
    deviceCredentialSnapshot,
    deviceCredentialServerSnapshot,
  );
  const [status, setStatus] = useState<KioskStatus>('IDLE');
  const [camera, setCamera] = useState<CameraStatus>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [powerPhase, setPowerPhase] = useState<PowerSavePhase>('awake');
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
  const [selectedGarment, setSelectedGarment] = useState<{
    garmentId: string;
    variantId: string;
    category?: string | null;
    isTestFixture?: boolean;
    colorName?: string | null;
    sizeLabel?: string | null;
  } | null>(null);
  const [gesture, setGesture] = useState<{
    id: number;
    command: 'next-view' | 'next-size';
  } | null>(null);
  const [physicalTrial, setPhysicalTrial] = useState<TrialOverlaySelection | null>(null);

  const view = presentKiosk(status);
  const qrValue = pairingQrValue(pairingUrl, device?.deviceSecret ?? null);
  if (qrValue !== qrFor) {
    setQrFor(qrValue);
    setQrSvg(null);
  }
  const showScreensaver = shouldShowScreensaver(status, powerPhase);
  const tryOnActive = shouldRunTryOnPipeline(status, powerPhase);
  const customerGarment = status === 'ACTIVE' ? selectedGarment : null;
  const usingTrial = customerGarment === null && physicalTrial !== null && powerPhase === 'awake';
  const showTryOn = Boolean(overlayRoot && (tryOnActive || usingTrial));
  const overlayGarment = customerGarment ?? (usingTrial ? physicalTrial : null);
  const cameraPresence = resolveCameraPresence({
    flag: camera,
    video: videoRef.current,
  });

  const noteActivity = useCallback((wake = true) => {
    lastActivityRef.current = Date.now();
    if (wake && powerPhaseRef.current === 'saving') {
      powerPhaseRef.current = 'awake';
      setPowerPhase('awake');
    }
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    powerPhaseRef.current = powerPhase;
  }, [powerPhase]);

  // Presence / claim / garment changes count as activity + coarse analytics.
  useEffect(() => {
    noteActivity(true);
    const garmentKey = selectedGarment
      ? `${selectedGarment.garmentId}:${selectedGarment.variantId}`
      : '';
    if (garmentKey && garmentKey !== prevGarmentKeyRef.current) {
      analyticsRef.current.noteTryOnSelection(
        resolveFitCategory(selectedGarment?.category ?? null),
      );
    }
    prevGarmentKeyRef.current = garmentKey;

    if (status === 'ACTIVE' && prevStatusRef.current !== 'ACTIVE') {
      analyticsRef.current.noteSessionStarted();
    }
    if (status === 'ENDED' && prevStatusRef.current !== 'ENDED') {
      analyticsRef.current.noteSessionEnded();
    }
    prevStatusRef.current = status;
  }, [status, selectedGarment, noteActivity]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const wake = () => noteActivity(true);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('touchstart', wake, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('touchstart', wake);
    };
  }, [noteActivity]);

  useEffect(() => {
    if (!device) return;
    const tick = window.setInterval(() => {
      const next = evaluatePowerSave({
        phase: powerPhaseRef.current,
        nowMs: Date.now(),
        lastActivityMs: lastActivityRef.current,
        idleMs: DEFAULT_POWER_SAVE_IDLE_MS,
        kioskStatus: statusRef.current,
      });
      if (next !== powerPhaseRef.current) {
        powerPhaseRef.current = next;
        setPowerPhase(next);
      }
    }, POWER_SAVE_TICK_MS);
    return () => window.clearInterval(tick);
  }, [device]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      setCamera('unavailable');
      setCameraError('Camera video element was not ready on the mirror page.');
      return;
    }

    const provider = new BrowserCameraProvider({
      createVideo: () => video,
      // Keep play wait under the UI watchdog so start() can reject first.
      playTimeoutMs: 9_000,
      busyRetryDelayMs: 350,
    });
    cameraRef.current = provider;
    fpsRef.current.reset();
    setCamera('starting');
    setCameraError(null);

    let cancelled = false;
    const syncLiveFromElement = () => {
      if (cancelled) return;
      if (video.srcObject && video.videoWidth > 0 && video.videoHeight > 0) {
        setCamera('live');
        setCameraError(null);
      }
    };
    video.addEventListener('loadedmetadata', syncLiveFromElement);
    video.addEventListener('playing', syncLiveFromElement);

    const startWatch = window.setTimeout(() => {
      if (cancelled) return;
      // Prefer the real element: start() may still be awaiting play while the
      // feed is already attached and sized (false "unavailable" previously).
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.srcObject) {
        setCamera('live');
        setCameraError(null);
        return;
      }
      let markedUnavailable = false;
      setCamera((current) => {
        if (current !== 'starting') return current;
        markedUnavailable = true;
        return 'unavailable';
      });
      if (markedUnavailable) {
        setCameraError(
          (prev) =>
            prev ??
            'Camera did not become ready in time. Use HTTPS /mirror, allow camera, and confirm no other app holds it.',
        );
      }
    }, CAMERA_START_MS);

    void provider
      .start(CAMERA_CONSTRAINTS)
      .then(() => {
        if (cancelled) return;
        setCamera('live');
        setCameraError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof Error && error.message.includes('cancelled')) return;
        // Only mark unavailable when the element truly has no feed.
        if (video.srcObject && video.videoWidth > 0 && video.videoHeight > 0) {
          setCamera('live');
          setCameraError(null);
          return;
        }
        setCamera('unavailable');
        setCameraError(provider.lastError ?? describeCameraStartError(error));
      });

    return () => {
      cancelled = true;
      window.clearTimeout(startWatch);
      video.removeEventListener('loadedmetadata', syncLiveFromElement);
      video.removeEventListener('playing', syncLiveFromElement);
      cameraRef.current = null;
      void provider.dispose();
    };
  }, []);

  // Frame sample pump: full RAF while awake, throttled interval while power-saving.
  useEffect(() => {
    if (camera !== 'live') return;
    let raf = 0;
    let fpsTimer = 0;
    const sampleFrame = () => {
      noteCameraFrame(fpsRef.current, cameraRef.current?.readFrame() ?? null);
    };
    const pumpRaf = () => {
      sampleFrame();
      raf = window.requestAnimationFrame(pumpRaf);
    };
    if (powerPhase === 'saving') {
      sampleFrame();
      fpsTimer = window.setInterval(sampleFrame, POWER_SAVE_FPS_MS);
    } else {
      raf = window.requestAnimationFrame(pumpRaf);
    }
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearInterval(fpsTimer);
    };
  }, [powerPhase, camera]);

  useEffect(() => {
    if (!device) return;

    const loop = startHeartbeatLoop({
      getSecret: () => loadDeviceCredential()?.deviceSecret ?? null,
      getSample: () => ({
        camera_ok: cameraPresence === 'live' || camera === 'live',
        render_fps: fpsRef.current.fps(),
        metrics: analyticsRef.current.toHeartbeatMetrics(),
      }),
      fetchFn: fetch,
      onUnauthorized: () => {
        clearDeviceCredential();
        lifecycleRef.current.markSessionEnded();
        clearSessionUi();
        setStatus('IDLE');
      },
    });

    void loop.tick();
    return () => loop.stop();
  }, [device, camera, cameraPresence]);

  useEffect(() => {
    if (!device || status !== 'IDLE') return;
    const life = lifecycleRef.current;
    const openSeq = life.beginOpen(status);
    if (openSeq === null) return;
    let cancelled = false;

    void createKioskSession(device.deviceSecret)
      .then((created) => {
        if (cancelled) {
          life.failOpen(openSeq);
          return;
        }
        if (life.completeOpen(openSeq, created.sessionId) === null) return;
        setPairingUrl(created.pairingUrl);
        setStatus((current) => reduceKiosk(current, 'SESSION_OPENED'));
        noteActivity(true);
      })
      .catch(() => {
        life.failOpen(openSeq);
        if (cancelled) return;
        setPairingUrl(null);
        window.setTimeout(() => {
          if (!cancelled) setOpenAttempt((n) => n + 1);
        }, 5000);
      });

    return () => {
      cancelled = true;
      life.failOpen(openSeq);
    };
  }, [device, status, openAttempt, noteActivity]);

  useEffect(() => {
    if (!device) return;
    if (status === 'IDLE' || status === 'ENDED') return;

    let cancelled = false;

    const runPoll = async (): Promise<void> => {
      if (cancelled) return;
      const life = lifecycleRef.current;
      const { generation, sessionId } = life.beginPoll();
      if (!sessionId) return;
      try {
        const live = await readLiveSession(device.deviceSecret);
        if (cancelled) return;
        const applied = life.applyPoll(generation, live, Date.now());
        if (applied.kind === 'stale') return;

        pollResilienceRef.current = notePollSuccess(pollResilienceRef.current, Date.now());
        setPollHealth((current) => (current === 'ok' ? current : 'ok'));

        if (applied.live?.selectedGarment !== undefined) {
          const next = applied.live.selectedGarment;
          setSelectedGarment((current) => {
            if (!next && !current) return current;
            if (
              current?.garmentId === next?.garmentId &&
              current?.variantId === next?.variantId &&
              current?.category === next?.category &&
              current?.isTestFixture === next?.isTestFixture &&
              current?.colorName === next?.colorName &&
              current?.sizeLabel === next?.sizeLabel
            ) {
              return current;
            }
            return next ?? null;
          });
        }

        const event = applied.event;
        if (event === 'PAIRING_CLAIMED' && statusRef.current === 'WAITING') {
          noteActivity(true);
          setPairingUrl(null);
          setStatus((current) => reduceKiosk(current, 'PAIRING_CLAIMED'));
          if (applied.live?.status === 'ACTIVE') {
            setStatus((current) => reduceKiosk(current, 'SESSION_ACTIVATED'));
            return;
          }
          const ok = await activateKioskSession(device.deviceSecret, sessionId);
          if (ok && life.getSessionId() === sessionId) {
            setStatus((current) => reduceKiosk(current, 'SESSION_ACTIVATED'));
          }
        } else if (event === 'SESSION_ENDED') {
          life.markSessionEnded();
          clearSessionUi();
          setStatus((current) => reduceKiosk(current, 'SESSION_ENDED'));
        }
      } catch {
        // Transient poll / auth errors are not session end. Skip counting a
        // failure if a newer generation already replaced this poll's epoch
        // (overlapping 1s polls after END → create).
        if (cancelled) return;
        if (life.getGeneration() !== generation) return;
        pollResilienceRef.current = notePollFailure(pollResilienceRef.current, Date.now());
        setPollHealth(pollResilienceRef.current.health);
      }
    };

    const poll = window.setInterval(() => {
      void runPoll();
    }, kioskSessionPollMs(status));
    void runPoll();

    const onOnline = () => {
      if (shouldForcePollOnReconnect(pollResilienceRef.current)) {
        void runPoll();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onOnline();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [device, status, noteActivity]);

  useEffect(() => {
    if (status !== 'ENDED') return;
    const timer = window.setTimeout(() => {
      setStatus((current) => reduceKiosk(current, 'RESET'));
    }, RESET_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!qrValue) return;

    let cancelled = false;
    void import('@/lib/kiosk/qr-svg')
      .then(({ pairingQrSvg }) => pairingQrSvg(qrValue, device?.deviceSecret ?? null))
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setQrSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qrValue, device]);

  function clearSessionUi(): void {
    setPairingUrl(null);
    setQrSvg(null);
    setSelectedGarment(null);
  }

  async function onEnroll(formData: FormData): Promise<void> {
    setEnrollError(null);
    const rawCode = formData.get('code');
    const code = typeof rawCode === 'string' ? rawCode : '';
    try {
      const enrolled = await enrollDevice(code);
      const saved = saveDeviceCredential(enrolled);
      if (!saved.ok) {
        setEnrollError(
          saved.reason === 'quota'
            ? 'Device storage is full. Free space and try again.'
            : saved.reason === 'unavailable' || saved.reason === 'restricted'
              ? 'This browser blocked device storage. Enable local storage or try another browser.'
              : 'That code could not be used. Ask staff for a new one.',
        );
        return;
      }
      noteActivity(true);
    } catch {
      setEnrollError('That code could not be used. Ask staff for a new one.');
    }
  }

  async function onEndSession(): Promise<void> {
    const life = lifecycleRef.current;
    const sessionId = life.getSessionId();
    const secret = device?.deviceSecret;
    if (sessionId && secret) {
      await endKioskSession(secret, sessionId, 'CUSTOMER_ENDED');
    }
    life.markSessionEnded();
    clearSessionUi();
    setStatus((current) => reduceKiosk(current, 'SESSION_ENDED'));
    noteActivity(true);
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-base text-primary">
      <video
        ref={videoRef}
        className="absolute inset-0 z-0 size-full object-cover"
        style={{
          transform: 'scaleX(-1)',
          opacity: showScreensaver ? 0.15 : 1,
          transition: 'opacity 200ms ease',
        }}
        muted
        playsInline
        autoPlay
        aria-hidden
      />
      <LucyClipStage
        videoRef={videoRef}
        active={Boolean(device) && tryOnActive}
        garment={
          customerGarment
            ? {
                garmentId: customerGarment.garmentId,
                variantId: customerGarment.variantId,
              }
            : null
        }
        getSessionId={() => lifecycleRef.current.getSessionId()}
      />
      {/* Dims the camera only — translucent; must stay below the try-on overlay. */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-base/40" aria-hidden />
      {/* Full-bleed garment overlay host (transparent; above video + scrim, below UI). */}
      <div
        ref={setOverlayRoot}
        className="pointer-events-none absolute inset-0 z-[2] bg-transparent"
        data-testid="tryon-overlay-host"
        aria-hidden
      />

      {showScreensaver ? (
        <KioskScreensaver
          qrSvg={qrSvg}
          showQr={status === 'WAITING' || status === 'IDLE'}
          activeSession={status === 'ACTIVE'}
          onWake={() => noteActivity(true)}
        />
      ) : null}

      <div className="relative z-10 flex min-h-dvh flex-col justify-between px-10 py-12">
        <p className="text-xs uppercase tracking-[0.4em] text-accent">In-store kiosk</p>

        <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
          {!device ? (
            <UnenrolledPanel error={enrollError} onEnroll={onEnroll} />
          ) : (
            <>
              <div className="space-y-3">
                <h1 className="text-6xl font-light tracking-[0.18em] text-primary sm:text-7xl">
                  {view.title}
                </h1>
                <p className="text-2xl font-light tracking-wide text-secondary">{view.subtitle}</p>
              </div>

              {view.showQrPlaceholder ? (
                qrSvg ? (
                  <div
                    className="size-56 overflow-hidden rounded-lg bg-white p-3"
                    data-testid="pairing-qr"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                ) : (
                  <div
                    className="glass flex size-56 flex-col items-center justify-center gap-2 rounded-lg"
                    data-testid="pairing-qr-pending"
                  >
                    <span className="text-xs uppercase tracking-[0.3em] text-muted">QR</span>
                    <span className="max-w-40 text-sm text-secondary">
                      Waiting for a pairing URL. No stand-in code is shown.
                    </span>
                  </div>
                )
              ) : null}

              <p className="max-w-md text-sm text-muted">{view.honesty}</p>
              {pollHealth === 'degraded' ? (
                <p
                  className="max-w-md text-sm text-accent"
                  role="status"
                  data-testid="poll-degraded"
                >
                  Sync recovering after a network drop. Session epoch is preserved — retrying…
                </p>
              ) : null}

              {showTryOn && overlayRoot ? (
                <ClientErrorBoundary
                  title="Try-on panel"
                  body="Pose rendering hit an error. Camera preview continues; tap try again to reload fitting."
                  onError={() => {
                    analyticsRef.current.noteRenderError();
                  }}
                >
                  <TryOnPanel
                    active={tryOnActive || usingTrial}
                    overlayRoot={overlayRoot}
                    getFrame={() => cameraRef.current?.readFrame() ?? null}
                    getSessionId={() => (usingTrial ? null : lifecycleRef.current.getSessionId())}
                    selectedGarment={
                      overlayGarment
                        ? {
                            garmentId: overlayGarment.garmentId,
                            variantId: overlayGarment.variantId,
                          }
                        : null
                    }
                    selectedCategory={overlayGarment?.category ?? null}
                    selectedIsTestFixture={overlayGarment?.isTestFixture === true}
                    onPresenceChange={(present) => {
                      if (present) {
                        analyticsRef.current.notePersonSeen();
                        noteActivity(true);
                      }
                    }}
                    onGesture={(command) => {
                      setGesture((current) => ({ id: (current?.id ?? 0) + 1, command }));
                    }}
                  />
                  <MannequinDock
                    category={overlayGarment?.category ?? null}
                    colorName={overlayGarment?.colorName ?? null}
                    sizeLabel={overlayGarment?.sizeLabel ?? null}
                    gesture={gesture}
                  />
                </ClientErrorBoundary>
              ) : null}

              <div
                className="flex flex-wrap items-center justify-center gap-3"
                data-testid="physical-trial"
              >
                <button
                  type="button"
                  disabled={customerGarment !== null}
                  onClick={() => {
                    setPhysicalTrial(TRIAL_SHIRT_OVERLAY);
                    noteActivity(true);
                  }}
                  className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-secondary disabled:opacity-40"
                >
                  Trial shirt
                </button>
                <button
                  type="button"
                  disabled={customerGarment !== null}
                  onClick={() => {
                    setPhysicalTrial(TRIAL_PANTS_OVERLAY);
                    noteActivity(true);
                  }}
                  className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-secondary disabled:opacity-40"
                >
                  Trial pants
                </button>
                {physicalTrial && customerGarment === null ? (
                  <button
                    type="button"
                    onClick={() => setPhysicalTrial(null)}
                    className="text-xs uppercase tracking-[0.2em] text-muted underline-offset-4 hover:underline"
                  >
                    Clear trial
                  </button>
                ) : null}
              </div>

              {status === 'ACTIVE' || status === 'PAIRED' || status === 'WAITING' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void document.documentElement.requestFullscreen?.();
                    }}
                    className="text-xs uppercase tracking-[0.25em] text-muted underline-offset-4 hover:text-secondary hover:underline"
                  >
                    Full screen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void onEndSession();
                    }}
                    className="text-xs uppercase tracking-[0.25em] text-muted underline-offset-4 hover:text-secondary hover:underline"
                  >
                    End session
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>

        <footer className="flex items-end justify-between gap-6 text-xs text-muted">
          <p>
            {cameraPresence === 'live'
              ? showScreensaver
                ? 'Camera idle · pose processing paused to save power.'
                : 'Camera on this device. One still is uploaded only if you allow realistic try-on.'
              : cameraPresence === 'starting'
                ? 'Starting camera…'
                : cameraError
                  ? `Camera unavailable. ${cameraError}`
                  : 'Camera unavailable. This screen will not invent a feed.'}
          </p>
          <p className="uppercase tracking-[0.25em]">
            {device
              ? [
                  showScreensaver ? `${view.status} · POWER SAVE` : view.status,
                  pollHealth === 'degraded' ? 'SYNC DEGRADED' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'UNENROLLED'}
          </p>
        </footer>
      </div>
    </main>
  );
}
