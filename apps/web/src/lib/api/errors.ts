import { NextResponse } from 'next/server';

/**
 * What an untrusted client is allowed to be told when something goes wrong.
 *
 * Two kinds of caller reach these routes and neither is a database user: a
 * mirror sitting in a shop on whatever network the store happens to have,
 * and a customer's phone that holds nothing but a scanned token. So the
 * error vocabulary is deliberately coarse. It tells the caller what to do
 * next and nothing about why the server decided that.
 *
 * In particular there is one code for every way an enrollment code can fail
 * and one for every way a pairing token can fail. Separating "expired" from
 * "already used" from "never existed" would confirm to someone guessing that
 * a guess had been correct at some point.
 */
export const CLIENT_ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_CODE',
  'INVALID_TOKEN',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

const STATUS_BY_CODE: Readonly<Record<ClientErrorCode, number>> = {
  INVALID_REQUEST: 400,
  INVALID_CODE: 400,
  INVALID_TOKEN: 400,
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function clientError(
  code: ClientErrorCode,
  options?: { readonly retryAfterMs?: number },
): NextResponse {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (code === 'RATE_LIMITED' && options?.retryAfterMs !== undefined) {
    const seconds = Math.max(1, Math.ceil(options.retryAfterMs / 1000));
    headers['Retry-After'] = String(seconds);
  }
  return NextResponse.json({ error: code }, { status: STATUS_BY_CODE[code], headers });
}
