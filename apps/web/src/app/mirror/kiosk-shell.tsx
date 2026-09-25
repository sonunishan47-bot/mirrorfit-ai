'use client';

import { useEffect, useRef, useState } from 'react';

import { FrameRateCounter } from '@mirrorfit/tryon-core';

import { BrowserCameraProvider } from '@/lib/camera/browser-camera';
import { startHeartbeatLoop } from '@/lib/device/heartbeat-loop';
import {
  clearDeviceCredential,
  loadDeviceCredential,
  saveDeviceCredential,
  type StoredDeviceCredential,
} from '@/lib/device/store';
import { noteCameraFrame } from '@/lib/kiosk/fps';
import { presentKiosk, reduceKiosk, type KioskStatus } from '@/lib/kiosk/machine';
import { pairingQrValue } from '@/lib/kiosk/pairing-qr';
import {
  activateKioskSession,
  createKioskSession,
  endKioskSession,
  enrollDevice,
  eventFromLiveSession,
  readLiveSession,
} from '@/lib/kiosk/session-client';
import { TryOnPanel } from './tryon-panel';
import { UnenrolledPanel } from './unenrolled-panel';

const CAMERA_CONSTRAINTS = { width: 1920, height: 1080, frameRate: 30 } as const;
const CAMERA_START_MS = 8_000;
const POLL_MS = 1000;
const RESET_MS = 1600;

type CameraStatus = 'starting' | 'live' | 'unavailable';

/**
 * Live kiosk: enrolled device, heartbeat, real session, real pairing QR.
 *
 * Camera frames stay in the local `<video>` element. The QR encodes only
 * `/s?t=…`. The device secret is read from local persistence and sent as a
 * bearer header; it is never rendered.
 */
export function KioskShell() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<BrowserCameraProvider | null>(null);
  const fpsRef = useRef(new FrameRateCounter());
  const statusRef = useRef<KioskStatus>('IDLE');
  const sessionIdRef = useRef<string | null>(null);
  const openingRef = useRef(false);

  const [device, setDevice] = useState<StoredDeviceCredential | null>(null);
  const [status, setStatus] = useState<KioskStatus>('IDLE');
  const [camera, setCamera] = useState<CameraStatus>('starting');
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [selectedGarment, setSelectedGarment] = useState<{
    garmentId: string;
    variantId: string;
    category?: string | null;
    isTestFixture?: boolean;
  } | null>(null);

  const view = presentKiosk(status);
  const qrValue = pairingQrValue(pairingUrl, device?.deviceSecret ?? null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    setDevice(loadDeviceCredential());
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      setCamera('unavailable');
      return;
    }

    const provider = new BrowserCameraProvider({ createVideo: () => video });
    cameraRef.current = provider;
    fpsRef.current.reset();

    let cancelled = false;
    let raf = 0;
    const startWatch = window.setTimeout(() => {
      if (!cancelled) {
        setCamera((current) => (current === 'starting' ? 'unavailable' : current));
      }
    }, CAMERA_START_MS);

    const pump = () => {
      noteCameraFrame(fpsRef.current, cameraRef.current?.readFrame() ?? null);
      raf = window.requestAnimationFrame(pump);
    };

    void provider
      .start(CAMERA_CONSTRAINTS)
      .then(() => {
        if (cancelled) return;
        setCamera('live');
        raf = window.requestAnimationFrame(pump);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof Error && error.message.includes('cancelled')) return;
        setCamera('unavailable');
      });

    return () => {
      cancelled = true;
      window.clearTimeout(startWatch);
      window.cancelAnimationFrame(raf);
      cameraRef.current = null;
      void provider.dispose();
    };
  }, []);

  useEffect(() => {
    if (!device) return;

    const loop = startHeartbeatLoop({
      getSecret: () => loadDeviceCredential()?.deviceSecret ?? null,
      getSample: () => ({
        camera_ok: camera === 'live',
        render_fps: fpsRef.current.fps(),
      }),
      fetchFn: fetch,
      onUnauthorized: () => {
        clearDeviceCredential();
        setDevice(null);
        clearSession();
        setStatus('IDLE');
      },
    });

    void loop.tick();
    return () => loop.stop();
  }, [device, camera]);

  useEffect(() => {
    if (!device || status !== 'IDLE') return;
    if (openingRef.current) return;
    openingRef.current = true;
    let cancelled = false;

    void createKioskSession(device.deviceSecret)
      .then((created) => {
        if (cancelled) return;
        sessionIdRef.current = created.sessionId;
        setPairingUrl(created.pairingUrl);
        setStatus((current) => reduceKiosk(current, 'SESSION_OPENED'));
      })
      .catch(() => {
        if (cancelled) return;
        setPairingUrl(null);
        window.setTimeout(() => {
          if (!cancelled) setOpenAttempt((n) => n + 1);
        }, 5000);
      })
      .finally(() => {
        openingRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [device, status, openAttempt]);

  useEffect(() => {
    if (!device) return;
    if (status === 'IDLE' || status === 'ENDED') return;

    const poll = window.setInterval(() => {
      void (async () => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        try {
          const live = await readLiveSession(device.deviceSecret);
          const event = eventFromLiveSession(live, sessionId, Date.now());
          if (live?.selectedGarment !== undefined) {
            const next = live.selectedGarment;
            setSelectedGarment((current) => {
              if (!next && !current) return current;
              if (
                current?.garmentId === next?.garmentId &&
                current?.variantId === next?.variantId &&
                current?.category === next?.category &&
                current?.isTestFixture === next?.isTestFixture
              ) {
                return current;
              }
              return next ?? null;
            });
          }
          if (event === 'PAIRING_CLAIMED' && statusRef.current === 'WAITING') {
            setPairingUrl(null);
            setStatus((current) => reduceKiosk(current, 'PAIRING_CLAIMED'));
            if (live?.status === 'ACTIVE') {
              setStatus((current) => reduceKiosk(current, 'SESSION_ACTIVATED'));
              return;
            }
            const ok = await activateKioskSession(device.deviceSecret, sessionId);
            if (ok) {
              setStatus((current) => reduceKiosk(current, 'SESSION_ACTIVATED'));
            }
          } else if (event === 'SESSION_ENDED') {
            clearSession();
            setStatus((current) => reduceKiosk(current, 'SESSION_ENDED'));
          }
        } catch {
          // A poll failure is not a session end. The next tick retries.
        }
      })();
    }, POLL_MS);

    return () => window.clearInterval(poll);
  }, [device, status]);

  useEffect(() => {
    if (status !== 'ENDED') return;
    const timer = window.setTimeout(() => {
      setStatus((current) => reduceKiosk(current, 'RESET'));
    }, RESET_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!qrValue) {
      setQrSvg(null);
      return;
    }

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

  function clearSession(): void {
    sessionIdRef.current = null;
    setPairingUrl(null);
    setQrSvg(null);
    setSelectedGarment(null);
  }

  async function onEnroll(formData: FormData): Promise<void> {
    setEnrollError(null);
    const code = String(formData.get('code') ?? '');
    try {
      const enrolled = await enrollDevice(code);
      saveDeviceCredential(enrolled);
      setDevice(enrolled);
    } catch {
      setEnrollError('That code could not be used. Ask staff for a new one.');
    }
  }

  async function onEndSession(): Promise<void> {
    const sessionId = sessionIdRef.current;
    const secret = device?.deviceSecret;
    if (sessionId && secret) {
      await endKioskSession(secret, sessionId, 'CUSTOMER_ENDED');
    }
    clearSession();
    setStatus((current) => reduceKiosk(current, 'SESSION_ENDED'));
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-base text-primary">
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
        muted
        playsInline
        autoPlay
        aria-hidden
      />
      <div className="absolute inset-0 bg-base/40" />

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
                    // The SVG is produced locally from a pairing URL we already validated.
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

              {status === 'ACTIVE' ? (
                <TryOnPanel
                  active
                  getFrame={() => cameraRef.current?.readFrame() ?? null}
                  selectedGarment={selectedGarment}
                  selectedCategory={selectedGarment?.category ?? null}
                  selectedIsTestFixture={selectedGarment?.isTestFixture === true}
                />
              ) : null}

              {status === 'ACTIVE' || status === 'PAIRED' || status === 'WAITING' ? (
                <button
                  type="button"
                  onClick={() => {
                    void onEndSession();
                  }}
                  className="text-xs uppercase tracking-[0.25em] text-muted underline-offset-4 hover:text-secondary hover:underline"
                >
                  End session
                </button>
              ) : null}
            </>
          )}
        </div>

        <footer className="flex items-end justify-between gap-6 text-xs text-muted">
          <p>
            {camera === 'live'
              ? 'Camera on this device. Frames stay here.'
              : camera === 'starting'
                ? 'Starting camera…'
                : 'Camera unavailable. This screen will not invent a feed.'}
          </p>
          <p className="uppercase tracking-[0.25em]">{device ? view.status : 'UNENROLLED'}</p>
        </footer>
      </div>
    </main>
  );
}
