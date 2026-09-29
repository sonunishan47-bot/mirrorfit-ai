import { describe, expect, it } from 'vitest';

import { authorizeWorkerRequest, workerSecretMatches } from './worker-auth';

describe('worker authentication', () => {
  it('accepts only an exact secret and rejects empty or shorter values', () => {
    expect(workerSecretMatches('worker-secret-value', 'worker-secret-value')).toBe(true);
    expect(workerSecretMatches('worker-secret-value', 'worker-secret-other')).toBe(false);
    expect(workerSecretMatches('short', 'worker-secret-value')).toBe(false);
    expect(workerSecretMatches(null, 'worker-secret-value')).toBe(false);
    expect(workerSecretMatches('worker-secret-value', null)).toBe(false);
  });

  it('rejects a missing worker secret even if a bearer is presented', () => {
    const request = new Request('https://mirror.test/api/worker/tryon-jobs/claim', {
      headers: { authorization: 'Bearer worker-secret-value' },
    });
    expect(authorizeWorkerRequest(request, {})).toBe(false);
    expect(
      authorizeWorkerRequest(request, {
        WORKER_SECRET: 'worker-secret-value',
      }),
    ).toBe(true);
    expect(
      authorizeWorkerRequest(request, {
        WORKER_SECRET: 'different-secret-value',
      }),
    ).toBe(false);
  });
});
