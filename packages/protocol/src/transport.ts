import type { FieldIssue } from '@mirrorfit/validation';
import { decodeMessage } from './codec';
import type { ProtocolErrorCode } from './message-types';
import type { ProtocolMessage } from './messages';

export const TRANSPORT_STATUSES = [
  'IDLE',
  'CONNECTING',
  'CONNECTED',
  'RECONNECTING',
  'CLOSED',
  'ERRORED',
] as const;

export type TransportStatus = (typeof TRANSPORT_STATUSES)[number];

export type Unsubscribe = () => void;

export interface TransportDecodeError {
  readonly code: ProtocolErrorCode;
  readonly issues: readonly FieldIssue[];
}

/**
 * Transport-agnostic realtime link between a mirror and a paired phone.
 *
 * Business logic depends only on this interface. The Supabase Realtime
 * implementation arrives in Phase 7; swapping it for raw WebSockets or a
 * different provider must not require touching call sites.
 */
export interface RealtimeTransport {
  readonly status: TransportStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: ProtocolMessage): Promise<void>;
  onMessage(handler: (message: ProtocolMessage) => void): Unsubscribe;
  onStatusChange(handler: (status: TransportStatus) => void): Unsubscribe;
  /**
   * Inbound traffic that failed validation. Surfaced rather than thrown so a
   * single malformed message cannot tear down a live fitting session.
   */
  onDecodeError(handler: (error: TransportDecodeError) => void): Unsubscribe;
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

/**
 * Loopback transport used by tests and local development.
 *
 * Two endpoints created from the same hub deliver to each other, which lets
 * the full mirror/phone message exchange be exercised without a network or a
 * Supabase project.
 */
export class InMemoryTransportHub {
  readonly #endpoints = new Set<InMemoryTransport>();

  createEndpoint(): RealtimeTransport {
    const endpoint = new InMemoryTransport(this);
    this.#endpoints.add(endpoint);
    return endpoint;
  }

  /** @internal */
  deliver(from: InMemoryTransport, raw: unknown): void {
    for (const endpoint of this.#endpoints) {
      if (endpoint === from) continue;
      endpoint.receive(raw);
    }
  }
}

class InMemoryTransport implements RealtimeTransport {
  #status: TransportStatus = 'IDLE';
  readonly #hub: InMemoryTransportHub;
  readonly #messages = createEmitter<ProtocolMessage>();
  readonly #statuses = createEmitter<TransportStatus>();
  readonly #decodeErrors = createEmitter<TransportDecodeError>();

  constructor(hub: InMemoryTransportHub) {
    this.#hub = hub;
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
    this.#setStatus('CONNECTING');
    this.#setStatus('CONNECTED');
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.#setStatus('CLOSED');
    this.#messages.clear();
    this.#decodeErrors.clear();
    return Promise.resolve();
  }

  send(message: ProtocolMessage): Promise<void> {
    if (this.#status !== 'CONNECTED') {
      return Promise.reject(new Error(`Cannot send while transport is ${this.#status}`));
    }
    // Round-trip through JSON so tests exercise the same serialization path as
    // a real network transport.
    this.#hub.deliver(this, JSON.parse(JSON.stringify(message)) as unknown);
    return Promise.resolve();
  }

  /** @internal */
  receive(raw: unknown): void {
    if (this.#status !== 'CONNECTED') return;
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
