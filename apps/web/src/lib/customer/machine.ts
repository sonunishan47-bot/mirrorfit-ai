/**
 * Customer-facing pairing states on `/s`.
 *
 * LOADING is the brief read of `?t=`. READY is the Connect screen. The
 * phone's only network step is claim: activate is a device-bearer call on
 * the kiosk, per the Phase 3 contract. CONNECTED / ACTIVATING / MIRROR_READY
 * are the glass the customer sees after a successful claim, not a second
 * lifecycle RPC.
 */

export const CUSTOMER_STATUSES = [
  'LOADING',
  'READY',
  'CONNECTING',
  'CONNECTED',
  'ACTIVATING',
  'MIRROR_READY',
  'INVALID',
  'FAILED',
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_EVENTS = [
  'TOKEN_READY',
  'TOKEN_MISSING',
  'TOKEN_MALFORMED',
  'CONNECT',
  'CLAIMED',
  'CLAIM_FAILED',
  'MIRROR_PREPARING',
  'MIRROR_CONFIRMED',
  'RETRY',
] as const;
export type CustomerEvent = (typeof CUSTOMER_EVENTS)[number];

export type CustomerFailureKind = 'invalid' | 'network' | 'server';
export type CustomerInvalidKind = 'missing' | 'malformed';

const TRANSITIONS: Readonly<
  Record<CustomerStatus, Partial<Record<CustomerEvent, CustomerStatus>>>
> = {
  LOADING: {
    TOKEN_READY: 'READY',
    TOKEN_MISSING: 'INVALID',
    TOKEN_MALFORMED: 'INVALID',
  },
  READY: {
    CONNECT: 'CONNECTING',
  },
  CONNECTING: {
    CLAIMED: 'CONNECTED',
    CLAIM_FAILED: 'FAILED',
  },
  CONNECTED: {
    MIRROR_PREPARING: 'ACTIVATING',
  },
  ACTIVATING: {
    MIRROR_CONFIRMED: 'MIRROR_READY',
  },
  MIRROR_READY: {},
  INVALID: {},
  FAILED: {
    RETRY: 'READY',
  },
};

export function reduceCustomer(status: CustomerStatus, event: CustomerEvent): CustomerStatus {
  return TRANSITIONS[status][event] ?? status;
}

export interface CustomerPresentation {
  readonly status: CustomerStatus;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly action: string | null;
  readonly actionBusy: boolean;
  readonly tone: 'neutral' | 'progress' | 'success' | 'error';
}

export function presentCustomer(
  status: CustomerStatus,
  options: {
    invalidKind?: CustomerInvalidKind;
    failureKind?: CustomerFailureKind;
  } = {},
): CustomerPresentation {
  switch (status) {
    case 'LOADING':
      return {
        status,
        eyebrow: 'MirrorFit AI',
        title: 'Just a moment',
        body: 'Opening your fitting session.',
        action: null,
        actionBusy: false,
        tone: 'progress',
      };
    case 'READY':
      return {
        status,
        eyebrow: 'MirrorFit AI',
        title: 'Connect to Mirror',
        body: 'Ready to start your fitting session?',
        action: 'Connect',
        actionBusy: false,
        tone: 'neutral',
      };
    case 'CONNECTING':
      return {
        status,
        eyebrow: 'MirrorFit AI',
        title: 'Connect to Mirror',
        body: 'Connecting you to the mirror…',
        action: 'Connect',
        actionBusy: true,
        tone: 'progress',
      };
    case 'CONNECTED':
      return {
        status,
        eyebrow: 'MirrorFit AI',
        title: 'Connected',
        body: 'Your phone is paired with the mirror.',
        action: null,
        actionBusy: false,
        tone: 'success',
      };
    case 'ACTIVATING':
      return {
        status,
        eyebrow: 'MirrorFit AI',
        title: 'Almost there',
        body: 'The mirror is getting ready.',
        action: null,
        actionBusy: false,
        tone: 'progress',
      };
    case 'MIRROR_READY':
      return {
        status,
        eyebrow: 'MirrorFit AI',
        title: 'Mirror Ready',
        body: 'You can now use the mirror.',
        action: null,
        actionBusy: false,
        tone: 'success',
      };
    case 'INVALID':
      return {
        status,
        eyebrow: 'MirrorFit AI',
        title: options.invalidKind === 'missing' ? 'No mirror code' : 'This link is not valid',
        body:
          options.invalidKind === 'missing'
            ? 'Scan the code on the screen in front of you to begin.'
            : 'Scan the code on the mirror again.',
        action: null,
        actionBusy: false,
        tone: 'error',
      };
    case 'FAILED':
      return {
        status,
        eyebrow: 'MirrorFit AI',
        title:
          options.failureKind === 'invalid'
            ? 'This code is no longer valid'
            : options.failureKind === 'network'
              ? 'Could not reach the mirror'
              : 'Something went wrong',
        body:
          options.failureKind === 'invalid'
            ? 'Ask the mirror for a new code, then scan again.'
            : options.failureKind === 'network'
              ? 'Check your connection and try again.'
              : 'Please try again in a moment.',
        action: options.failureKind === 'invalid' ? null : 'Try again',
        actionBusy: false,
        tone: 'error',
      };
  }
}
