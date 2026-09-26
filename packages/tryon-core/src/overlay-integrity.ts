/**
 * SHA-256 hex of overlay bytes for integrity checks against garment_assets.content_hash.
 *
 * Browser: crypto.subtle. Node tests: inject digestFn. Returns null when hashing
 * is unavailable — callers must treat that as verification failure, never skip.
 */

const HEX = '0123456789abcdef';

export type DigestFn = (data: ArrayBuffer) => Promise<ArrayBuffer>;

export async function sha256Hex(
  data: ArrayBuffer,
  digestFn?: DigestFn,
): Promise<string | null> {
  if (data.byteLength <= 0) return null;
  const digest = digestFn ?? defaultDigest();
  if (!digest) return null;
  try {
    const hash = await digest(data);
    return bufferToHex(hash);
  } catch {
    return null;
  }
}

/**
 * True only when the digest matches the expected 64-char lowercase hex hash.
 * Missing digest capability or malformed expectation → false (fail closed).
 */
export async function matchesContentHash(
  data: ArrayBuffer,
  expectedHash: string,
  digestFn?: DigestFn,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const actual = await sha256Hex(data, digestFn);
  return actual !== null && actual === expectedHash;
}

function defaultDigest(): DigestFn | null {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') return null;
  return (data) => subtle.digest('SHA-256', data);
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) {
    out += HEX[(byte >> 4) & 0xf];
    out += HEX[byte & 0xf];
  }
  return out;
}
