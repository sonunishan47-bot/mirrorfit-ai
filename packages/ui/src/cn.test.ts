import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy values', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values but keeps zero', () => {
    expect(cn('a', null, undefined, false, '', 'b')).toBe('a b');
    expect(cn(0, 'a')).toBe('0 a');
  });

  it('flattens nested arrays', () => {
    expect(cn('a', ['b', ['c', null]], 'd')).toBe('a b c d');
  });

  it('returns an empty string when nothing applies', () => {
    expect(cn(false, null, undefined)).toBe('');
  });
});
