import { describe, expect, it } from 'vitest';

import { ENROLLMENT_CODE_ALPHABET, normalizeEnrollmentCode } from '@mirrorfit/types';

import { generateDeviceSecret, generateEnrollmentCode, sha256Hex } from './secrets';

const SAMPLE_SIZE = 2000;

describe('generateEnrollmentCode', () => {
  it('produces codes the normaliser accepts unchanged', () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generateEnrollmentCode();
      expect(normalizeEnrollmentCode(code)).toBe(code);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      seen.add(generateEnrollmentCode());
    }
    expect(seen.size).toBe(SAMPLE_SIZE);
  });

  it('draws every character from the alphabet roughly evenly', () => {
    // Guards the modulo-bias assumption in `generateEnrollmentCode`. If the
    // alphabet ever stops dividing 256 evenly, some characters appear 1.5x as
    // often as others and this notices. The bound is loose enough not to
    // flake: with ~750 draws per character the observed count stays well
    // inside half to double the expected value.
    const counts = new Map<string, number>();
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      for (const char of generateEnrollmentCode()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    expect(counts.size).toBe(ENROLLMENT_CODE_ALPHABET.length);

    const expected = (SAMPLE_SIZE * 12) / ENROLLMENT_CODE_ALPHABET.length;
    for (const [char, count] of counts) {
      expect(ENROLLMENT_CODE_ALPHABET, `unexpected character ${char}`).toContain(char);
      expect(count).toBeGreaterThan(expected * 0.5);
      expect(count).toBeLessThan(expected * 1.5);
    }
  });
});

describe('generateDeviceSecret', () => {
  it('is url-safe so it survives an Authorization header', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateDeviceSecret()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('carries 256 bits', () => {
    // 32 bytes in base64url, unpadded.
    expect(generateDeviceSecret()).toHaveLength(43);
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      seen.add(generateDeviceSecret());
    }
    expect(seen.size).toBe(SAMPLE_SIZE);
  });
});

describe('sha256Hex', () => {
  it('matches the digest the database check constraint expects', () => {
    // device_credentials.secret_hash and device_enrollment_codes.code_hash
    // both enforce ^[0-9a-f]{64}$, so a mismatch here is a failed insert.
    expect(sha256Hex('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('agrees with a known vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is stable across calls and sensitive to a single character', () => {
    expect(sha256Hex('mirror-1')).toBe(sha256Hex('mirror-1'));
    expect(sha256Hex('mirror-1')).not.toBe(sha256Hex('mirror-2'));
  });
});
