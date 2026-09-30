import { describe, expect, it } from 'vitest';

import { bodyText, headersText, requestUrl } from '@/lib/fetch-text';

import { claimPairingSession } from './claim-client';

const TOKEN = 'k'.repeat(43);
const SESSION_ID = '44444444-4444-4444-8444-444444444444';

describe('customer claim client', () => {
  it('posts only to the existing claim route and treats PAIRED as success', async () => {
    const urls: string[] = [];
    const outcome = await claimPairingSession(TOKEN, (input, init) => {
      urls.push(requestUrl(input));
      expect(init?.method).toBe('POST');
      expect(JSON.parse(bodyText(init?.body))).toEqual({ token: TOKEN });
      return Promise.resolve(
        new Response(JSON.stringify({ session_id: SESSION_ID, status: 'PAIRED', locale: 'en' }), {
          status: 200,
        }),
      );
    });

    expect(urls).toEqual(['/api/session/claim']);
    expect(outcome).toEqual({ ok: true, sessionId: SESSION_ID, status: 'PAIRED' });
  });

  it('maps expired, used and unknown tokens to the same customer failure', async () => {
    const outcome = await claimPairingSession(TOKEN, () =>
      Promise.resolve(new Response(JSON.stringify({ error: 'INVALID_TOKEN' }), { status: 400 })),
    );
    expect(outcome).toEqual({ ok: false, reason: 'invalid' });
  });

  it('maps a dropped network to a retryable failure', async () => {
    const outcome = await claimPairingSession(TOKEN, () => Promise.reject(new Error('offline')));
    expect(outcome).toEqual({ ok: false, reason: 'network' });
  });

  it('maps a server failure without leaking diagnostic text', async () => {
    const outcome = await claimPairingSession(TOKEN, () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'INTERNAL', hint: 'relation sessions' }), {
          status: 500,
        }),
      ),
    );
    expect(outcome).toEqual({ ok: false, reason: 'server' });
  });

  it('never calls activate or sends tenancy fields', async () => {
    const urls: string[] = [];
    await claimPairingSession(TOKEN, (input, init) => {
      urls.push(requestUrl(input));
      expect(bodyText(init?.body)).not.toContain('organization_id');
      expect(bodyText(init?.body)).not.toContain('display_id');
      expect(headersText(init?.headers)).not.toMatch(/Bearer /);
      return Promise.resolve(
        new Response(JSON.stringify({ session_id: SESSION_ID, status: 'PAIRED' }), {
          status: 200,
        }),
      );
    });
    expect(urls.some((url) => url.includes('activate'))).toBe(false);
  });
});
