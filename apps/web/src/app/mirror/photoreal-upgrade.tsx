'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  AsyncTryOnQueue,
  resolveFitCategory,
  stillCaptureDecision,
  type CameraFrame,
} from '@mirrorfit/tryon-core';

import { loadDeviceCredential } from '@/lib/device/store';
import { captureStillJpeg } from '@/lib/tryon/capture-still';
import { fetchCurrentTryOnJob, postDeviceTryOnJob } from '@/lib/tryon/tryon-job-client';
import { photorealResultVisible, resultMatchesSelection } from '@/lib/tryon/tryon-job-policy';

/**
 * Optional realistic layer. One consented JPEG per garment selection.
 * The pose loop is untouched. A failure, timeout, or missing model hides
 * this layer and leaves the 2D overlay in place. No image is invented.
 */
export function PhotorealUpgrade({
  active,
  overlayRoot,
  getFrame,
  getSessionId,
  selectedGarment,
  selectedCategory,
  personPresent,
  bodyConfidence,
}: {
  active: boolean;
  overlayRoot: HTMLElement | null;
  getFrame: () => CameraFrame | null;
  getSessionId: () => string | null;
  selectedGarment: { garmentId: string; variantId: string } | null;
  selectedCategory: string | null;
  personPresent: boolean;
  bodyConfidence: number | null;
}) {
  const liveRef = useRef({
    getFrame,
    getSessionId,
    personPresent,
    bodyConfidence,
  });

  const sessionId = getSessionId();
  const garmentKey = selectedGarment
    ? `${selectedGarment.garmentId}:${selectedGarment.variantId}`
    : '';
  const [consent, setConsent] = useState<{
    sessionId: string;
    choice: 'granted' | 'declined';
  } | null>(null);
  const choice = consent && consent.sessionId === sessionId ? consent.choice : 'pending';
  const [note, setNote] = useState<{ scope: string; text: string } | null>(null);
  const [result, setResult] = useState<{ key: string; url: string } | null>(null);
  const scope = `${sessionId ?? ''}:${garmentKey}`;
  const outputUrl = result?.key === garmentKey ? result.url : null;
  const shownNote = note?.scope === scope ? note.text : null;

  useEffect(() => {
    liveRef.current = { getFrame, getSessionId, personPresent, bodyConfidence };
  }, [getFrame, getSessionId, personPresent, bodyConfidence]);

  useEffect(() => {
    if (!active || choice !== 'granted' || !garmentKey || !sessionId) {
      return;
    }
    const separator = garmentKey.indexOf(':');
    const garment = {
      garmentId: garmentKey.slice(0, separator),
      variantId: garmentKey.slice(separator + 1),
    };
    const key = garmentKey;
    const noteScope = `${sessionId}:${key}`;
    const queue = new AsyncTryOnQueue();
    let stopped = false;

    void queue
      .enqueue(async (token) => {
        const deadline = Date.now() + 8_000;
        let jpeg: Uint8Array | null = null;
        while (!token.cancelled && Date.now() < deadline) {
          const live = liveRef.current;
          const currentSession = live.getSessionId();
          const decision = stillCaptureDecision({
            personDetected: live.personPresent,
            bodyConfidence: live.bodyConfidence,
            sessionActive: currentSession === sessionId,
            garmentSelected: true,
          });
          if (decision.ok) {
            jpeg = await captureStillJpeg(live.getFrame(), token.signal);
            if (jpeg) break;
          }
          await delay(400, token.signal);
          if (token.cancelled) return null;
        }
        if (!jpeg || token.cancelled) return null;
        const secret = loadDeviceCredential()?.deviceSecret ?? null;
        if (!secret) return null;
        const created = await postDeviceTryOnJob({
          secret,
          sessionId,
          garmentId: garment.garmentId,
          variantId: garment.variantId,
          jpeg,
          signal: token.signal,
        });
        if (!created || token.cancelled) return null;

        while (!token.cancelled) {
          const current = await fetchCurrentTryOnJob(secret, sessionId, token.signal);
          if (current === null || current === 'none') return null;
          if (
            !resultMatchesSelection(
              { garmentId: current.garment_id, variantId: current.variant_id },
              garment,
            )
          ) {
            return null;
          }
          if (current.status === 'SUCCEEDED' && current.output_url) return current.output_url;
          if (current.status === 'FAILED' || current.status === 'CANCELLED') {
            return current.error_code === 'VTON_NOT_CONNECTED' ? 'NOT_CONNECTED' : 'FAILED';
          }
          await delay(1000, token.signal);
        }
        return null;
      })
      .then((value) => {
        if (stopped) return;
        if (typeof value === 'string' && isHttpUrl(value)) {
          setResult({ key, url: value });
          setNote(null);
          return;
        }
        setResult((current) => (current?.key === key ? null : current));
        if (value === 'NOT_CONNECTED') {
          setNote({
            scope: noteScope,
            text: 'Realistic model is not connected. The live overlay stays.',
          });
          return;
        }
        setNote((current) => (current?.scope === noteScope ? null : current));
      });

    return () => {
      stopped = true;
      queue.cancel();
    };
  }, [active, choice, garmentKey, sessionId]);

  if (!active || !selectedGarment) return null;

  const family = resolveFitCategory(selectedCategory);
  const showImage = photorealResultVisible({
    outputUrl,
    resultGarmentId: outputUrl ? selectedGarment.garmentId : null,
    resultVariantId: outputUrl ? selectedGarment.variantId : null,
    selectedGarmentId: selectedGarment.garmentId,
    selectedVariantId: selectedGarment.variantId,
    personPresent,
  });

  const image =
    showImage && outputUrl && overlayRoot
      ? createPortal(
          // Signed URL lives on Supabase for about two minutes. next/image would cache it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={outputUrl}
            alt=""
            className="pointer-events-none absolute inset-0 z-[2] size-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
            data-testid="photoreal-result"
            onError={() => {
              setResult(null);
            }}
          />,
          overlayRoot,
        )
      : null;

  return (
    <>
      {image}
      <div
        className="relative z-[2] max-w-md space-y-2 text-sm text-muted"
        data-testid="photoreal-consent"
      >
        {family === 'FULL_BODY' ? (
          <p>
            The live mirror shows a pose silhouette for this garment, not a photograph. A realistic
            still appears only if a model returns one.
          </p>
        ) : null}
        {choice === 'pending' ? (
          <>
            <p>
              Optional realistic try-on uploads one still photo of you. It is deleted when the
              session ends. The live overlay does not wait for it.
            </p>
            <div className="flex justify-center gap-4">
              <button
                type="button"
                className="text-xs uppercase tracking-[0.2em] text-secondary underline-offset-4 hover:underline"
                onClick={() => {
                  if (!sessionId) return;
                  setConsent({ sessionId, choice: 'granted' });
                  setNote({
                    scope,
                    text: 'Waiting for one realistic try-on. The live overlay stays.',
                  });
                }}
              >
                Allow one still
              </button>
              <button
                type="button"
                className="text-xs uppercase tracking-[0.2em] text-muted underline-offset-4 hover:underline"
                onClick={() => {
                  if (!sessionId) return;
                  setConsent({ sessionId, choice: 'declined' });
                  setNote(null);
                }}
              >
                Not now
              </button>
            </div>
          </>
        ) : null}
        {choice === 'declined' ? (
          <button
            type="button"
            className="text-xs uppercase tracking-[0.2em] text-muted underline-offset-4 hover:underline"
            onClick={() => {
              if (!sessionId) return;
              setConsent({ sessionId, choice: 'granted' });
            }}
          >
            Allow realistic try-on
          </button>
        ) : null}
        {shownNote ? <p>{shownNote}</p> : null}
      </div>
    </>
  );
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
