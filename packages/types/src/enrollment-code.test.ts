import { describe, expect, it } from 'vitest';

import {
  ENROLLMENT_CODE_ALPHABET,
  ENROLLMENT_CODE_LENGTH,
  formatEnrollmentCode,
  normalizeEnrollmentCode,
} from './enrollment-code';

describe('the enrollment code alphabet', () => {
  it('omits the characters people confuse when reading aloud', () => {
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(ENROLLMENT_CODE_ALPHABET).not.toContain(excluded);
    }
  });

  it('has no repeated character, so a code has exactly one spelling', () => {
    expect(new Set(ENROLLMENT_CODE_ALPHABET).size).toBe(ENROLLMENT_CODE_ALPHABET.length);
  });

  it('carries enough entropy that guessing within the code lifetime is hopeless', () => {
    // 32^12 is 2^60. A ten-minute window would need roughly 10^15 attempts
    // per second to be worth trying, so the short lifetime plus single use is
    // genuine protection rather than a comforting note in a comment.
    const bits = Math.log2(ENROLLMENT_CODE_ALPHABET.length) * ENROLLMENT_CODE_LENGTH;
    expect(bits).toBeGreaterThanOrEqual(60);
  });
});

describe('normalizeEnrollmentCode', () => {
  it('accepts a canonical code unchanged', () => {
    expect(normalizeEnrollmentCode('4K7P9WQ2XM3T')).toBe('4K7P9WQ2XM3T');
  });

  it('accepts the grouped form a manager reads off the screen', () => {
    expect(normalizeEnrollmentCode('4K7P-9WQ2-XM3T')).toBe('4K7P9WQ2XM3T');
  });

  it('tolerates lower case and stray whitespace', () => {
    expect(normalizeEnrollmentCode('  4k7p 9wq2\tXM3T ')).toBe('4K7P9WQ2XM3T');
  });

  it('maps the characters people type by mistake', () => {
    // I and L are typed for 1, O for 0.
    expect(normalizeEnrollmentCode('IK7P9WQ2XM3T')).toBe('1K7P9WQ2XM3T');
    expect(normalizeEnrollmentCode('LK7P9WQ2XM3T')).toBe('1K7P9WQ2XM3T');
    expect(normalizeEnrollmentCode('OK7P9WQ2XM3T')).toBe('0K7P9WQ2XM3T');
  });

  it('rejects U rather than mapping it, because it is not a confusion', () => {
    expect(normalizeEnrollmentCode('UK7P9WQ2XM3T')).toBeNull();
  });

  it('rejects the wrong length', () => {
    expect(normalizeEnrollmentCode('4K7P9WQ2XM3')).toBeNull();
    expect(normalizeEnrollmentCode('4K7P9WQ2XM3TT')).toBeNull();
    expect(normalizeEnrollmentCode('')).toBeNull();
  });

  it('rejects characters outside the alphabet', () => {
    expect(normalizeEnrollmentCode('4K7P9WQ2XM3!')).toBeNull();
    expect(normalizeEnrollmentCode('4K7P9WQ2XM3\u00e9')).toBeNull();
  });

  it('never returns a string containing a character it would later reject', () => {
    const normalized = normalizeEnrollmentCode('il0o-1234-5678');
    expect(normalized).not.toBeNull();
    for (const char of normalized ?? '') {
      expect(ENROLLMENT_CODE_ALPHABET).toContain(char);
    }
  });
});

describe('formatEnrollmentCode', () => {
  it('groups in fours for reading aloud', () => {
    expect(formatEnrollmentCode('4K7P9WQ2XM3T')).toBe('4K7P-9WQ2-XM3T');
  });

  it('round-trips through normalization', () => {
    const code = '4K7P9WQ2XM3T';
    expect(normalizeEnrollmentCode(formatEnrollmentCode(code))).toBe(code);
  });
});
