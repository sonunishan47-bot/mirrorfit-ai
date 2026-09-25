import type { Viewport } from 'next';

import { PAIRING_TOKEN_PARAM, parsePairingToken } from '@/lib/session/pairing-url';

import { PairingExperience, type PairingStartKind } from './pairing-experience';

export const metadata = {
  title: 'MirrorFit AI',
  description: 'Connect your phone to the in-store mirror.',
};

export const viewport: Viewport = {
  themeColor: '#F7F6F2',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const dynamic = 'force-dynamic';

function startKindFromSearch(
  raw: string | string[] | undefined,
): Exclude<PairingStartKind, 'loading'> {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === '') {
    return 'missing';
  }
  return parsePairingToken(value) ? 'ok' : 'malformed';
}

/**
 * Customer landing after a QR scan: `/s?t=…`.
 *
 * Public on purpose. The pairing token is the credential; there is no staff
 * cookie. The server only learns whether `t` is present and well-formed. The
 * raw token is not passed into the rendered tree; the client reads it from
 * the address bar and sends it only to the existing claim route.
 */
export default async function PairingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const startKind = startKindFromSearch(params[PAIRING_TOKEN_PARAM]);
  return <PairingExperience startKind={startKind} />;
}
