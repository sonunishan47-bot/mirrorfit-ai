/** @vitest-environment happy-dom */

import { createElement } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UnenrolledPanel } from './unenrolled-panel';

afterEach(cleanup);

describe('unenrolled kiosk panel', () => {
  it('does not invent a credential and submits via button click, not a GET', () => {
    const onEnroll = vi.fn((formData: FormData) => {
      expect(formData.get('code')).toBe('STAFFCODE12');
      return Promise.resolve();
    });

    render(createElement(UnenrolledPanel, { error: null, onEnroll }));

    expect(screen.getByText('This mirror is not enrolled')).toBeTruthy();
    expect(screen.queryByText(/Scan to Start/i)).toBeNull();

    const form = document.querySelector('form');
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post');
    expect(screen.getByRole('button', { name: 'Enroll this mirror' })).toHaveProperty(
      'type',
      'button',
    );

    const input = screen.getByLabelText('Enrollment code');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Enrollment code is not an input');
    }
    input.value = 'STAFFCODE12';
    fireEvent.click(screen.getByRole('button', { name: 'Enroll this mirror' }));

    expect(onEnroll).toHaveBeenCalledTimes(1);
  });

  it('shows a refusal without rendering a secret', () => {
    render(
      createElement(UnenrolledPanel, {
        error: 'That code could not be used. Ask staff for a new one.',
        onEnroll: () => Promise.resolve(),
      }),
    );

    expect(screen.getByText(/could not be used/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/device_secret|Bearer |sb_secret_/);
  });
});
