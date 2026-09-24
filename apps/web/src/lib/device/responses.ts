import { NextResponse } from 'next/server';

/**
 * What a mirror is allowed to be told when something goes wrong.
 *
 * A mirror sits in a shop on whatever network the store happens to have, and
 * its endpoints are unauthenticated until it holds a credential. So the error
 * vocabulary is deliberately coarse: it tells the device what to do next and
 * nothing about why the server decided that.
 *
 * In particular there is one code for every way an enrollment code can fail.
 * Separating "expired" from "already used" from "never existed" would confirm
 * to someone guessing codes that a guess had been correct at some point.
 */
export const DEVICE_ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_CODE',
  'UNAUTHORIZED',
  'INTERNAL',
] as const;

export type DeviceErrorCode = (typeof DEVICE_ERROR_CODES)[number];

const STATUS_BY_CODE: Readonly<Record<DeviceErrorCode, number>> = {
  INVALID_REQUEST: 400,
  INVALID_CODE: 400,
  UNAUTHORIZED: 401,
  INTERNAL: 500,
};

export function deviceError(code: DeviceErrorCode): NextResponse {
  return NextResponse.json({ error: code }, { status: STATUS_BY_CODE[code] });
}
