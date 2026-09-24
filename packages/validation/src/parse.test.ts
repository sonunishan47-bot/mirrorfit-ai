import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJsonBody, parseOrIssues } from './parse';
import { sha256HexSchema, slugSchema } from './primitives';

const schema = z.object({ name: z.string().min(2), age: z.int().positive() });

describe('parseOrIssues', () => {
  it('returns typed data on success', () => {
    const result = parseOrIssues(schema, { name: 'Amal', age: 30 });
    expect(result).toEqual({ ok: true, data: { name: 'Amal', age: 30 } });
  });

  it('reports the failing field path', () => {
    const result = parseOrIssues(schema, { name: 'A', age: 30 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('name');
  });

  it('never echoes the submitted value back in issues', () => {
    const secret = 'super-secret-pairing-token';
    const result = parseOrIssues(schema, { name: secret, age: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.issues)).not.toContain(secret);
  });
});

describe('parseJsonBody', () => {
  it('turns malformed JSON into a normal issue rather than throwing', async () => {
    const request = {
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    };
    const result = await parseJsonBody(schema, request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toMatch(/valid JSON/i);
  });
});

describe('primitives', () => {
  it('accepts a lowercase sha-256 digest and rejects uppercase or short input', () => {
    expect(sha256HexSchema.safeParse('a'.repeat(64)).success).toBe(true);
    expect(sha256HexSchema.safeParse('A'.repeat(64)).success).toBe(false);
    expect(sha256HexSchema.safeParse('abc').success).toBe(false);
  });

  it('accepts kebab-case slugs only', () => {
    expect(slugSchema.safeParse('summer-linen-shirt').success).toBe(true);
    expect(slugSchema.safeParse('Summer Linen').success).toBe(false);
    expect(slugSchema.safeParse('-leading').success).toBe(false);
  });
});
