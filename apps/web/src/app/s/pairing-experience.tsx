'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { BrandHeader } from '@/components/customer/brand-header';
import { ErrorState } from '@/components/customer/error-state';
import { PairingCard } from '@/components/customer/pairing-card';
import { PrimaryButton } from '@/components/customer/primary-button';
import { CustomerShell } from '@/components/customer/shell';
import { StatusMessage } from '@/components/customer/status-message';
import { ClientErrorBoundary } from '@/components/client-error-boundary';
import { claimPairingSession, type ClaimFailureReason } from '@/lib/customer/claim-client';
import {
  presentCustomer,
  reduceCustomer,
  type CustomerInvalidKind,
  type CustomerStatus,
} from '@/lib/customer/machine';
import { inspectPairingSearch } from '@/lib/session/pairing-url';
import { SessionCatalog } from './session-catalog';

const PREPARE_MS = 700;
const CONFIRM_MS = 800;

export type PairingStartKind = 'loading' | 'ok' | 'missing' | 'malformed';

export interface PairingExperienceProps {
  readonly startKind?: PairingStartKind;
  readonly readLocation?: () => { origin: string; search: string };
  readonly claim?: typeof claimPairingSession;
  readonly delayMs?: { prepare: number; confirm: number };
}

function statusFromStart(kind: PairingStartKind): CustomerStatus {
  if (kind === 'ok') return 'READY';
  if (kind === 'missing' || kind === 'malformed') return 'INVALID';
  return 'LOADING';
}

function defaultLocation(): { origin: string; search: string } {
  if (typeof window === 'undefined') {
    return { origin: 'http://localhost', search: '' };
  }
  return { origin: window.location.origin, search: window.location.search };
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const SERVER_LOCATION_KEY = 'server';

function subscribeBrowserLocation(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

function inspectLocationKey(locationKey: string) {
  const splitAt = locationKey.indexOf('\n');
  const origin = splitAt === -1 ? locationKey : locationKey.slice(0, splitAt);
  const search = splitAt === -1 ? '' : locationKey.slice(splitAt + 1);
  return inspectPairingSearch(origin, search);
}

/**
 * Customer pairing. The raw token is derived from the URL when claiming.
 * It is never written into the DOM, logs, or storage.
 */
export function PairingExperience({
  startKind = 'loading',
  readLocation = defaultLocation,
  claim = claimPairingSession,
  delayMs,
}: PairingExperienceProps) {
  const sessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<CustomerStatus>(() => statusFromStart(startKind));
  const [invalidKind, setInvalidKind] = useState<CustomerInvalidKind>(
    startKind === 'malformed' ? 'malformed' : 'missing',
  );
  const [failureKind, setFailureKind] = useState<ClaimFailureReason>('server');
  const locationKey = useSyncExternalStore(
    subscribeBrowserLocation,
    () => {
      const location = readLocation();
      return `${location.origin}\n${location.search}`;
    },
    () => SERVER_LOCATION_KEY,
  );
  const [appliedLocation, setAppliedLocation] = useState(SERVER_LOCATION_KEY);

  if (locationKey !== SERVER_LOCATION_KEY && appliedLocation !== locationKey) {
    const inspected = inspectLocationKey(locationKey);
    setAppliedLocation(locationKey);
    if (inspected.kind === 'ok') {
      setStatus((current) => reduceCustomer(current, 'TOKEN_READY'));
    } else {
      setInvalidKind(inspected.kind);
      setStatus((current) =>
        reduceCustomer(current, inspected.kind === 'missing' ? 'TOKEN_MISSING' : 'TOKEN_MALFORMED'),
      );
    }
  }

  const view = presentCustomer(status, { invalidKind, failureKind });

  useEffect(() => {
    if (status !== 'CONNECTED' && status !== 'ACTIVATING') return;

    const wait = prefersReducedMotion()
      ? 0
      : status === 'CONNECTED'
        ? (delayMs?.prepare ?? PREPARE_MS)
        : (delayMs?.confirm ?? CONFIRM_MS);
    const event = status === 'CONNECTED' ? 'MIRROR_PREPARING' : 'MIRROR_CONFIRMED';
    const timer = window.setTimeout(() => {
      setStatus((current) => reduceCustomer(current, event));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [status, delayMs]);

  // Stable identity so SessionCatalog does not remount-fetch on every parent render.
  const readToken = useCallback((): string | null => {
    const key =
      locationKey === SERVER_LOCATION_KEY
        ? `${readLocation().origin}\n${readLocation().search}`
        : locationKey;
    const inspected = inspectLocationKey(key);
    return inspected.kind === 'ok' ? inspected.token : null;
  }, [locationKey, readLocation]);

  async function onConnect(): Promise<void> {
    const token = readToken();
    if (!token) return;

    setStatus((current) => reduceCustomer(current, 'CONNECT'));
    const outcome = await claim(token);
    if (!outcome.ok) {
      setFailureKind(outcome.reason);
      setStatus((current) => reduceCustomer(current, 'CLAIM_FAILED'));
      return;
    }
    sessionIdRef.current = outcome.sessionId;
    setStatus((current) => reduceCustomer(current, 'CLAIMED'));
  }

  function onRetry(): void {
    setStatus((current) => reduceCustomer(current, 'RETRY'));
  }

  return (
    <CustomerShell>
      <div className="flex flex-1 flex-col justify-between gap-12 py-6">
        <BrandHeader />

        <PairingCard className="my-auto">
          <div className="space-y-8">
            {view.tone === 'error' ? (
              <ErrorState
                title={view.title}
                body={view.body}
                action={
                  view.action ? (
                    <PrimaryButton onClick={onRetry}>{view.action}</PrimaryButton>
                  ) : undefined
                }
              />
            ) : (
              <>
                <StatusMessage
                  title={view.title}
                  body={view.body}
                  live={status === 'READY' ? 'off' : 'polite'}
                />
                {view.action ? (
                  <PrimaryButton busy={view.actionBusy} onClick={() => void onConnect()}>
                    {view.action}
                  </PrimaryButton>
                ) : null}
                {status === 'MIRROR_READY' ? (
                  <ClientErrorBoundary
                    title="Catalog"
                    body="The garment list hit an error. Your pairing token was not shown. Try again to reload the catalog."
                  >
                    <SessionCatalog readToken={readToken} />
                  </ClientErrorBoundary>
                ) : null}
              </>
            )}
          </div>
        </PairingCard>

        <p className="text-center text-xs tracking-wide text-customer-quiet">
          Fitting happens on the mirror in front of you.
        </p>
      </div>
    </CustomerShell>
  );
}
