import { timingSafeEqual } from 'node:crypto';

import { readVtonProviderConfig, type VtonEnv } from './vton-provider';

/**
 * Worker credential. Not a device secret and not a customer token.
 * Missing or mismatched secrets fail closed. The browser never receives this.
 */
export function workerSecretMatches(presented: string | null, expected: string | null): boolean {
  if (!presented || !expected) return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function readWorkerSecret(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/** Fail closed when WORKER_SECRET is missing or the bearer does not match. */
export function authorizeWorkerRequest(request: Request, env: VtonEnv = process.env): boolean {
  const config = readVtonProviderConfig(env);
  return workerSecretMatches(readWorkerSecret(request), config.workerSecret);
}
