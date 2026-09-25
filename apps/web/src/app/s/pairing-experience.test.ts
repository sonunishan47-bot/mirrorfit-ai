/** @vitest-environment happy-dom */

import { createElement } from 'react';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PairingExperience } from './pairing-experience';

const TOKEN = 'm'.repeat(43);
const SESSION_ID = '55555555-5555-4555-8555-555555555555';
const SECRET = 'n'.repeat(43);

function renderPairing(options: {
  search: string;
  claim?: (
    token: string,
  ) => Promise<
    | { ok: true; sessionId: string; status: string }
    | { ok: false; reason: 'invalid' | 'network' | 'server' }
  >;
  delayMs?: { prepare: number; confirm: number };
}) {
  return render(
    createElement(PairingExperience, {
      readLocation: () => ({ origin: 'https://shop.example', search: options.search }),
      ...(options.claim ? { claim: options.claim } : {}),
      delayMs: options.delayMs ?? { prepare: 0, confirm: 0 },
    }),
  );
}

function pageText(): string {
  return document.body.textContent ?? '';
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify({ garments: [] }), { status: 200 }),
  );
});

describe('customer /s pairing experience', () => {
  it('shows a missing-token state without inventing a session', async () => {
    renderPairing({ search: '' });
    expect(await screen.findByText('No mirror code')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
    expect(pageText()).not.toContain(TOKEN);
  });

  it('shows a malformed-token state without rendering the raw value', async () => {
    renderPairing({ search: '?t=not-a-token' });
    expect(await screen.findByText('This link is not valid')).toBeTruthy();
    expect(pageText()).not.toContain('not-a-token');
  });

  it('shows Connect for a valid token without putting the token in the UI', async () => {
    renderPairing({ search: `?t=${TOKEN}` });
    const connect = await screen.findByRole('button', { name: 'Connect' });
    expect(screen.getByText('Connect to Mirror')).toBeTruthy();
    expect(screen.getByText('Ready to start your fitting session?')).toBeTruthy();
    expect(connect).toHaveProperty('type', 'button');
    expect((connect as HTMLButtonElement).className).toMatch(/min-h-12/);
    expect(pageText()).not.toContain(TOKEN);
    expect(pageText()).not.toContain(SECRET);
    expect(pageText()).not.toMatch(/device_secret|pairing_token_hash|Bearer /);
  });

  it('shows a loading claim, then connected, then mirror ready', async () => {
    let resolveClaim!: (value: { ok: true; sessionId: string; status: string }) => void;
    const claim = vi.fn(
      () =>
        new Promise<{ ok: true; sessionId: string; status: string }>((resolve) => {
          resolveClaim = resolve;
        }),
    );

    renderPairing({ search: `?t=${TOKEN}`, claim });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('button', { name: 'Connecting…' })).toBeTruthy();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith(TOKEN);

    await act(async () => {
      resolveClaim({ ok: true, sessionId: SESSION_ID, status: 'PAIRED' });
    });

    expect(await screen.findByText('Mirror Ready')).toBeTruthy();
    expect(screen.getByText('You can now use the mirror.')).toBeTruthy();
    expect(await screen.findByText('No garments are available for this shop yet. Nothing is invented here.')).toBeTruthy();
    expect(pageText()).not.toContain(TOKEN);
  });

  it('shows a friendly invalid-code error and does not offer a doomed retry', async () => {
    renderPairing({
      search: `?t=${TOKEN}`,
      claim: async () => ({ ok: false, reason: 'invalid' }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('This code is no longer valid')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(pageText()).not.toContain('INVALID_TOKEN');
    expect(pageText()).not.toContain(TOKEN);
  });

  it('recovers from a network failure without exposing internals', async () => {
    const claim = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'network' })
      .mockResolvedValueOnce({ ok: true, sessionId: SESSION_ID, status: 'PAIRED' });

    renderPairing({ search: `?t=${TOKEN}`, claim });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Could not reach the mirror')).toBeTruthy();
    expect(pageText()).not.toContain('TypeError');
    expect(pageText()).not.toContain('fetch');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Mirror Ready')).toBeTruthy();
  });

  it('maps a server failure to a customer-safe retry', async () => {
    renderPairing({
      search: `?t=${TOKEN}`,
      claim: async () => ({ ok: false, reason: 'server' }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Something went wrong')).toBeTruthy();
    expect(pageText()).not.toContain('INTERNAL');
    expect(pageText()).not.toContain('relation');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('never writes the pairing token into storage', async () => {
    renderPairing({ search: `?t=${TOKEN}` });
    await screen.findByRole('button', { name: 'Connect' });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('future customer visual language', () => {
  it('keeps garment tiles free of invented catalog copy unless a caller supplies it', async () => {
    const { GarmentCard } = await import('../../components/customer/garment-card');
    render(createElement(GarmentCard, { title: 'Silk blouse', category: 'Tops' }));
    expect(screen.getByText('Silk blouse')).toBeTruthy();
    expect(screen.getByText('Tops')).toBeTruthy();
    expect(screen.queryByText(/SKU|barcode|inventory/i)).toBeNull();
  });
});
