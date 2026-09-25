/**
 * Session-facing states of the in-store kiosk.
 *
 * IDLE is "no session": the QR attract screen. WAITING / PAIRED / ACTIVE
 * match `public.session_status` so a later slice can drive this machine from
 * the existing session routes without inventing a second vocabulary.
 *
 * ENDED is terminal on the glass. RESET is what returns the mirror to IDLE.
 * That two-step is deliberate: the customer should see that the session
 * finished before the attract screen comes back, and a test can assert both
 * moments rather than a hidden jump.
 *
 * This machine does not talk to the camera, the network, or a garment. It
 * only answers "what is this screen showing?"
 */

export const KIOSK_STATUSES = ['IDLE', 'WAITING', 'PAIRED', 'ACTIVE', 'ENDED'] as const;
export type KioskStatus = (typeof KIOSK_STATUSES)[number];

export const KIOSK_EVENTS = [
  'SESSION_OPENED',
  'PAIRING_CLAIMED',
  'SESSION_ACTIVATED',
  'SESSION_ENDED',
  'RESET',
] as const;
export type KioskEvent = (typeof KIOSK_EVENTS)[number];

const TRANSITIONS: Readonly<Record<KioskStatus, Partial<Record<KioskEvent, KioskStatus>>>> = {
  IDLE: {
    SESSION_OPENED: 'WAITING',
  },
  WAITING: {
    PAIRING_CLAIMED: 'PAIRED',
    SESSION_ENDED: 'ENDED',
    RESET: 'IDLE',
  },
  PAIRED: {
    SESSION_ACTIVATED: 'ACTIVE',
    SESSION_ENDED: 'ENDED',
    RESET: 'IDLE',
  },
  ACTIVE: {
    SESSION_ENDED: 'ENDED',
    RESET: 'IDLE',
  },
  ENDED: {
    RESET: 'IDLE',
  },
};

/**
 * Applies one event. An event that is not legal in the current status is
 * ignored: a late PAIRING_CLAIMED after RESET must not resurrect a session
 * on the glass.
 */
export function reduceKiosk(status: KioskStatus, event: KioskEvent): KioskStatus {
  return TRANSITIONS[status][event] ?? status;
}

export interface KioskPresentation {
  readonly status: KioskStatus;
  readonly title: string;
  readonly subtitle: string;
  readonly honesty: string;
  readonly showQrPlaceholder: boolean;
}

export function presentKiosk(status: KioskStatus): KioskPresentation {
  switch (status) {
    case 'IDLE':
      return {
        status,
        title: 'MIRRORFIT AI',
        subtitle: 'Scan to Start',
        honesty: 'Camera kiosk shell. Live garment fitting is not implemented yet.',
        showQrPlaceholder: true,
      };
    case 'WAITING':
      return {
        status,
        title: 'MIRRORFIT AI',
        subtitle: 'Waiting for a phone to scan',
        honesty: 'Pairing has been requested. No garment is on the glass.',
        showQrPlaceholder: true,
      };
    case 'PAIRED':
      return {
        status,
        title: 'Connecting',
        subtitle: 'A phone claimed this session',
        honesty: 'The mirror and phone are not exchanging fitting messages yet.',
        showQrPlaceholder: false,
      };
    case 'ACTIVE':
      return {
        status,
        title: 'Session live',
        subtitle: 'Camera preview only',
        honesty: 'This is a local camera feed. It is not an AI try-on.',
        showQrPlaceholder: false,
      };
    case 'ENDED':
      return {
        status,
        title: 'Session ended',
        subtitle: 'Returning to the start screen',
        honesty: 'Temporary session state is being cleared on this display.',
        showQrPlaceholder: false,
      };
  }
}
