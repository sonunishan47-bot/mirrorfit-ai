/**
 * The shape of a device enrollment code.
 *
 * A technician reads this off a manager's screen and types it into a mirror
 * in a shop, possibly from across the room, possibly over the phone. That
 * constrains the design more than any cryptographic consideration does:
 *
 *   - Crockford base32, which omits I, L, O and U. The first three are the
 *     characters people confuse with 1 and 0; U is omitted so that no random
 *     code can spell an obscenity.
 *   - Twelve characters, which is 60 bits. Short enough to type, and far
 *     beyond guessing within the ten-minute window the code is alive for.
 *   - Grouped in fours when displayed, because people read and re-read
 *     grouped digits far more reliably than a twelve-character run.
 *
 * Generation is deliberately not here. It needs a cryptographic random
 * source, and this package must stay dependency-free and usable in a browser.
 * Only the server mints codes.
 */

export const ENROLLMENT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ENROLLMENT_CODE_LENGTH = 12;
export const ENROLLMENT_CODE_GROUP_SIZE = 4;

/**
 * Characters people type instead of the ones we meant. Crockford defines
 * these substitutions, and accepting them costs nothing: none of them are in
 * the alphabet, so a mapped code is never ambiguous with a different code.
 */
const SUBSTITUTIONS: Readonly<Record<string, string>> = {
  I: '1',
  L: '1',
  O: '0',
};

/**
 * Accepts whatever a human typed and returns the canonical code, or `null` if
 * it could not be one.
 *
 * Tolerant about presentation — case, spaces, hyphens — and strict about
 * content. Returning `null` rather than throwing keeps the caller honest,
 * since the compiler makes them handle the failure.
 */
export function normalizeEnrollmentCode(raw: string): string | null {
  const stripped = raw.toUpperCase().replace(/[\s-]+/g, '');

  if (stripped.length !== ENROLLMENT_CODE_LENGTH) {
    return null;
  }

  let normalized = '';
  for (const char of stripped) {
    const mapped = SUBSTITUTIONS[char] ?? char;
    if (!ENROLLMENT_CODE_ALPHABET.includes(mapped)) {
      return null;
    }
    normalized += mapped;
  }

  return normalized;
}

/** Renders a canonical code for display, e.g. `4K7P-9WQ2-XM3T`. */
export function formatEnrollmentCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += ENROLLMENT_CODE_GROUP_SIZE) {
    groups.push(code.slice(i, i + ENROLLMENT_CODE_GROUP_SIZE));
  }
  return groups.join('-');
}
