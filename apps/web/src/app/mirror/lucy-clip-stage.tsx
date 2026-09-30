'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

import { loadDeviceCredential } from '@/lib/device/store';
import { LUCY_BUFFER_SECONDS, LUCY_MIN_CLIP_MS } from '@/lib/tryon/lucy-clip-config';

/**
 * Records the existing preview stream in short valid segments while the
 * customer session is awake. On a phone garment change, the last finished
 * segment goes to local Lucy Edit Dev. Playback stays on this mirror.
 */

interface GarmentRef {
  readonly garmentId: string;
  readonly variantId: string;
}

function openRecorder(stream: MediaStream): MediaRecorder {
  const preferred = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
}

export function LucyClipStage({
  videoRef,
  active,
  garment,
  getSessionId,
}: {
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly active: boolean;
  readonly garment: GarmentRef | null;
  readonly getSessionId: () => string | null;
}) {
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [segmentTick, setSegmentTick] = useState(0);
  const segmentRef = useRef<{ blob: Blob; durationMs: number } | null>(null);
  const getSessionIdRef = useRef(getSessionId);
  const sentKeyRef = useRef('');
  const inflightRef = useRef<AbortController | null>(null);
  const inflightKeyRef = useRef('');
  const garmentKey = garment ? `${garment.garmentId}:${garment.variantId}` : '';
  const [phase, setPhase] = useState<{
    key: string;
    status: 'idle' | 'wait' | 'editing' | 'failed';
  }>({ key: '', status: 'idle' });
  if (garmentKey !== phase.key) {
    setClipUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setPhase({ key: garmentKey, status: garment ? 'wait' : 'idle' });
  }

  useEffect(() => {
    getSessionIdRef.current = getSessionId;
  }, [getSessionId]);

  useEffect(() => {
    return () => {
      inflightRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    const stream = video?.srcObject;
    if (!(stream instanceof MediaStream) || typeof MediaRecorder === 'undefined') return;
    let recorder: MediaRecorder | null = null;
    let timer = 0;
    let stopped = false;

    const start = () => {
      if (stopped) return;
      const parts: Blob[] = [];
      const began = Date.now();
      let next: MediaRecorder;
      try {
        next = openRecorder(stream);
      } catch {
        return;
      }
      recorder = next;
      next.ondataavailable = (event) => {
        if (event.data.size > 0) parts.push(event.data);
      };
      next.onstop = () => {
        const durationMs = Date.now() - began;
        if (parts.length > 0 && durationMs >= LUCY_MIN_CLIP_MS) {
          segmentRef.current = {
            blob: new Blob(parts, { type: next.mimeType || 'video/webm' }),
            durationMs,
          };
          setSegmentTick((value) => value + 1);
        }
        if (!stopped) start();
      };
      try {
        next.start();
      } catch {
        return;
      }
      timer = window.setTimeout(() => {
        if (next.state === 'recording') next.stop();
      }, LUCY_BUFFER_SECONDS * 1000);
    };
    start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      if (recorder && recorder.state === 'recording') recorder.stop();
    };
  }, [active, videoRef]);

  useEffect(() => {
    if (inflightKeyRef.current && inflightKeyRef.current !== garmentKey) {
      inflightRef.current?.abort();
      inflightRef.current = null;
      inflightKeyRef.current = '';
    }
    if (!garmentKey) {
      sentKeyRef.current = '';
      return;
    }
    if (!active || !garment || sentKeyRef.current === garmentKey) return;
    const segment = segmentRef.current;
    if (!segment) return;
    const secret = loadDeviceCredential()?.deviceSecret;
    const sessionId = getSessionIdRef.current();
    if (!secret || !sessionId) return;

    sentKeyRef.current = garmentKey;
    const controller = new AbortController();
    inflightRef.current = controller;
    inflightKeyRef.current = garmentKey;
    setPhase({ key: garmentKey, status: 'editing' });
    const form = new FormData();
    form.set('session_id', sessionId);
    form.set('garment_id', garment.garmentId);
    form.set('variant_id', garment.variantId);
    form.set('duration_ms', String(segment.durationMs));
    form.set('clip', segment.blob, 'clip.webm');
    void fetch('/api/device/lucy-clip', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      body: form,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (sentKeyRef.current !== garmentKey) return;
        if (!response.ok) {
          setPhase({ key: garmentKey, status: 'failed' });
          return;
        }
        const blob = await response.blob();
        if (blob.size < 1024) {
          setPhase({ key: garmentKey, status: 'failed' });
          return;
        }
        const url = URL.createObjectURL(blob);
        setClipUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return url;
        });
        setPhase({ key: garmentKey, status: 'idle' });
      })
      .catch(() => {
        if (!controller.signal.aborted && sentKeyRef.current === garmentKey) {
          setPhase({ key: garmentKey, status: 'failed' });
        }
      })
      .finally(() => {
        if (inflightRef.current === controller) {
          inflightRef.current = null;
          inflightKeyRef.current = '';
        }
      });
  }, [active, garment, garmentKey, segmentTick]);

  if (!active && !clipUrl) return null;

  return (
    <>
      {clipUrl ? (
        <video
          key={clipUrl}
          src={clipUrl}
          className="absolute inset-0 z-[4] size-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
          autoPlay
          playsInline
          onEnded={() => {
            setClipUrl((current) => {
              if (current) URL.revokeObjectURL(current);
              return null;
            });
          }}
          data-testid="lucy-clip"
        />
      ) : null}
      {active && phase.status !== 'idle' ? (
        <p className="pointer-events-none absolute bottom-24 left-10 z-[11] max-w-md text-sm text-muted">
          {phase.status === 'failed'
            ? 'Local Lucy clip did not return. The live preview stays.'
            : phase.status === 'editing'
              ? 'Editing the last few seconds locally. The live preview stays until it is ready.'
              : 'Stay in frame. The clip needs a few seconds of preview.'}
        </p>
      ) : null}
    </>
  );
}
