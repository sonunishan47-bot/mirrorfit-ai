import {
  decodeMessage,
  type ProtocolMessage,
  type RealtimeTransport,
  type TransportDecodeError,
  type TransportStatus,
  type Unsubscribe,
} from '@mirrorfit/protocol';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase Realtime implementation of the transport seam.
 *
 * NOT PRODUCTION READY. Channel authorization is not enforced yet.
 *
 * The message plumbing below is complete and correct: envelopes are decoded
 * and validated before any handler sees them, a malformed message is
 * surfaced rather than thrown, and the status machine reports honestly. What
 * is missing is the part that decides *who may join a channel*. Supabase
 * Realtime treats a broadcast channel as open to any holder of the
 * publishable key unless Realtime Authorization is turned on, so today a
 * phone that knows another session's id could subscribe to it and watch that
 * fitting session.
 *
 * TODO (Phase 7): make these channels private and add an RLS policy on
 * `realtime.messages`, which requires minting a short-lived per-session JWT
 * for the customer's phone. That token does not exist yet, which is why the
 * gap is documented here instead of papered over: the fix is a design step,
 * not a config flag.
 *
 * Do not put this in front of real customers until that lands.
 *
 * Why this file lives in the app and not in `@mirrorfit/protocol`: the
 * protocol package must not import Supabase. Business logic depends on the
 * `RealtimeTransport` interface, and this is one implementation of it. The
 * in-memory hub in the protocol package is another, which is what lets the
 * message exchange be tested without a network.
 */

/**
 * One channel per session, so a subscription cannot accidentally span two.
 *
 * Exported because the mirror and the phone must derive the same name from
 * the same session id; two call sites formatting this string independently
 * would be a pairing failure nobody could reproduce.
 */
export function sessionChannelName(sessionId: string): string {
  return `session:${sessionId}`;
}

/** Every protocol message rides one broadcast event name. */
const BROADCAST_EVENT = 'protocol';

/**
 * Maps Supabase's subscription states onto the transport's vocabulary.
 *
 * `CHANNEL_ERROR` and `TIMED_OUT` are kept apart from `CLOSED` because the
 * first two mean the link failed and should be retried, while `CLOSED` means
 * someone hung up on purpose.
 */
export function toTransportStatus(
  supabaseStatus: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED',
): TransportStatus {
  switch (supabaseStatus) {
    case 'SUBSCRIBED':
      return 'CONNECTED';
    case 'CHANNEL_ERROR':
      return 'ERRORED';
    case 'TIMED_OUT':
      return 'RECONNECTING';
    case 'CLOSED':
      return 'CLOSED';
  }
}

function createEmitter<T>() {
  const handlers = new Set<(value: T) => void>();
  return {
    add(handler: (value: T) => void): Unsubscribe {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emit(value: T): void {
      for (const handler of [...handlers]) handler(value);
    },
    clear(): void {
      handlers.clear();
    },
  };
}

export interface SupabaseTransportOptions {
  readonly client: SupabaseClient;
  readonly sessionId: string;
}

export class SupabaseRealtimeTransport implements RealtimeTransport {
  #status: TransportStatus = 'IDLE';
  #channel: RealtimeChannel | null = null;

  readonly #client: SupabaseClient;
  readonly #sessionId: string;
  readonly #messages = createEmitter<ProtocolMessage>();
  readonly #statuses = createEmitter<TransportStatus>();
  readonly #decodeErrors = createEmitter<TransportDecodeError>();

  constructor(options: SupabaseTransportOptions) {
    this.#client = options.client;
    this.#sessionId = options.sessionId;
  }

  get status(): TransportStatus {
    return this.#status;
  }

  #setStatus(status: TransportStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#statuses.emit(status);
  }

  connect(): Promise<void> {
    if (this.#channel) {
      return Promise.resolve();
    }

    this.#setStatus('CONNECTING');

    const channel = this.#client.channel(sessionChannelName(this.#sessionId), {
      // Without this the sender receives its own messages back and every
      // peer processes its own state changes twice.
      config: { broadcast: { self: false } },
    });

    this.#channel = channel;

    channel.on('broadcast', { event: BROADCAST_EVENT }, ({ payload }) => {
      this.#receive(payload);
    });

    return new Promise((resolve) => {
      channel.subscribe((supabaseStatus) => {
        this.#setStatus(toTransportStatus(supabaseStatus));
        // Resolve on the first terminal state either way. A caller awaiting
        // connect() should not hang because the channel errored, and the
        // status it can read afterwards says which happened.
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    const channel = this.#channel;
    this.#channel = null;

    if (channel) {
      await this.#client.removeChannel(channel);
    }

    this.#setStatus('CLOSED');
    this.#messages.clear();
    this.#decodeErrors.clear();
  }

  async send(message: ProtocolMessage): Promise<void> {
    const channel = this.#channel;
    if (!channel || this.#status !== 'CONNECTED') {
      throw new Error(`Cannot send while transport is ${this.#status}`);
    }

    const result = await channel.send({
      type: 'broadcast',
      event: BROADCAST_EVENT,
      payload: message,
    });

    if (result !== 'ok') {
      throw new Error(`Realtime send failed: ${result}`);
    }
  }

  /**
   * Inbound traffic is untrusted even though it arrived over an authenticated
   * socket, because the peer on the other end is a browser. A message that
   * fails validation is reported and dropped, never thrown: one malformed
   * frame must not tear down a live fitting session.
   */
  #receive(raw: unknown): void {
    const result = decodeMessage(raw);
    if (result.ok) {
      this.#messages.emit(result.message);
    } else {
      this.#decodeErrors.emit({ code: result.code, issues: result.issues });
    }
  }

  onMessage(handler: (message: ProtocolMessage) => void): Unsubscribe {
    return this.#messages.add(handler);
  }

  onStatusChange(handler: (status: TransportStatus) => void): Unsubscribe {
    return this.#statuses.add(handler);
  }

  onDecodeError(handler: (error: TransportDecodeError) => void): Unsubscribe {
    return this.#decodeErrors.add(handler);
  }
}
