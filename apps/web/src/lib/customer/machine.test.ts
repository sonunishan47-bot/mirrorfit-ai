import { describe, expect, it } from 'vitest';

import { presentCustomer, reduceCustomer } from './machine';

describe('customer pairing machine', () => {
  it('moves loading → ready → connecting → connected → activating → mirror ready', () => {
    let status = reduceCustomer('LOADING', 'TOKEN_READY');
    expect(status).toBe('READY');
    expect(presentCustomer(status).title).toBe('Connect to Mirror');
    expect(presentCustomer(status).action).toBe('Connect');

    status = reduceCustomer(status, 'CONNECT');
    expect(status).toBe('CONNECTING');
    expect(presentCustomer(status).actionBusy).toBe(true);

    status = reduceCustomer(status, 'CLAIMED');
    expect(status).toBe('CONNECTED');
    expect(presentCustomer(status).title).toBe('Connected');
    expect(presentCustomer(status).body).toBe('Your phone is paired with the mirror.');

    status = reduceCustomer(status, 'MIRROR_PREPARING');
    expect(status).toBe('ACTIVATING');

    status = reduceCustomer(status, 'MIRROR_CONFIRMED');
    expect(status).toBe('MIRROR_READY');
    expect(presentCustomer(status).title).toBe('Mirror Ready');
    expect(presentCustomer(status).body).toBe('You can now use the mirror.');
  });

  it('treats a missing or malformed token as an invalid start, not a success', () => {
    expect(reduceCustomer('LOADING', 'TOKEN_MISSING')).toBe('INVALID');
    expect(presentCustomer('INVALID', { invalidKind: 'missing' }).title).toBe('No mirror code');
    expect(reduceCustomer('LOADING', 'TOKEN_MALFORMED')).toBe('INVALID');
    expect(presentCustomer('INVALID', { invalidKind: 'malformed' }).title).toBe(
      'This link is not valid',
    );
  });

  it('returns a failed claim to a recoverable ready state', () => {
    let status = reduceCustomer('CONNECTING', 'CLAIM_FAILED');
    expect(status).toBe('FAILED');
    expect(presentCustomer(status, { failureKind: 'network' }).action).toBe('Try again');
    status = reduceCustomer(status, 'RETRY');
    expect(status).toBe('READY');
  });

  it('does not resurrect an invalid page or invent a connected state', () => {
    expect(reduceCustomer('INVALID', 'CLAIMED')).toBe('INVALID');
    expect(reduceCustomer('READY', 'MIRROR_CONFIRMED')).toBe('READY');
    expect(presentCustomer('FAILED', { failureKind: 'invalid' }).action).toBeNull();
  });

  it('keeps customer copy free of tokens, secrets and API words', () => {
    const copy = [
      presentCustomer('READY'),
      presentCustomer('CONNECTING'),
      presentCustomer('CONNECTED'),
      presentCustomer('MIRROR_READY'),
      presentCustomer('FAILED', { failureKind: 'invalid' }),
    ]
      .map((view) => `${view.title} ${view.body} ${view.action ?? ''}`)
      .join(' ');

    expect(copy).not.toMatch(/token|API|RPC|bearer|hash|device secret|session_id/i);
  });
});
