import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { ENROLLMENT_CODE_ALPHABET, ENROLLMENT_CODE_LENGTH } from '@mirrorfit/types';

/**
 * Minting and hashing of device secrets.
 *
 * `server-only` because every function here either produces a secret or is
 * part of verifying one. None of it has any business in a browser bundle.
 */

/**
 * A fresh enrollment code in canonical form.
 *
 * The alphabet has exactly 32 characters and a byte has 256 values, so
 * `byte % 32` partitions the byte range into eight equal buckets and is
 * unbiased. That is a property of this specific alphabet length, not a
 * general truth about modulo on random bytes — change the alphabet and this
 * needs rejection sampling instead.
 */
export function generateEnrollmentCode(): string {
  const alphabetSize = ENROLLMENT_CODE_ALPHABET.length;
  if (256 % alphabetSize !== 0) {
    throw new Error('Enrollment code alphabet no longer divides the byte range evenly');
  }

  const bytes = randomBytes(ENROLLMENT_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += ENROLLMENT_CODE_ALPHABET[byte % alphabetSize];
  }
  return code;
}

/**
 * A long-lived device secret.
 *
 * 256 bits, url-safe so it survives being carried in an Authorization header
 * and written to a config file. Stored by the mirror, never typed by a human,
 * so there is no reason to trade strength for readability the way the
 * enrollment code has to.
 */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A single-use pairing token for one session's QR code.
 *
 * Same 256 bits as a device secret, and url-safe for the same reason: it
 * travels as a query parameter in the URL the QR code encodes. It is not
 * shortened for scannability, because a QR code is read by a camera and its
 * density costs nothing, whereas this token is the only thing standing
 * between a stranger and someone else's fitting session.
 */
export function generatePairingToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The stored form of a code or secret.
 *
 * A plain sha-256 is the right choice here, which is worth stating because
 * the reflex is to reach for bcrypt or argon2. Those exist to make guessing
 * cheap-to-guess human passwords expensive. These values are generated from
 * a cryptographic random source with 60 and 256 bits of entropy, so there is
 * no dictionary to run and nothing for a slow hash to buy. A slow hash would
 * only add latency to every device request.
 *
 * Lookup is by equality on an indexed hash column. There is no byte-by-byte
 * comparison against a user-supplied value for a timing attack to walk.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
