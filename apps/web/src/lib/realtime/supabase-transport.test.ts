import { createMessage, PROTOCOL_VERSION, type ProtocolMessage } from '@mirrorfit/protocol';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  sessionChannelName,
  SupabaseRealtimeTransport,
  toTransportStatus,
} from './supabase-transport';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

type SubscribeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
type BroadcastHandler = (message: { payload: unknown }) => void;

/**
 * A stand-in for the Supabase client that records what the transport did.
 *
 * Only the four members the transport touches are implemented. Faking the
 * whole client would be a lot of surface area to keep honest, and the point
 * of these tests is the transport's own behaviour, not Supabase's.
 */
function createFakeClient(subscribeWith: SubscribeStatus = 'SUBSCRIBED') {
  const state = {
    channelNames: [] as string[],
    sent: [] as unknown[],
    removed: 0,
    selfBroadcast: undefined as boolean | undefined,
    handler: null as BroadcastHandler | null,
    sendResult: 'ok' as string,
  };

  const channel = {
    on(_type: string, _filter: unknown, handler: BroadcastHandler) {
      state.handler = handler;
      return channel;
    },
    subscribe(callback: (status: SubscribeStatus) => void) {
      callback(subscribeWith);
      return channel;
    },
    send(payload: unknown) {
      state.sent.push(payload);
      return Promise.resolve(state.sendResult);
    },
  };

  const client = {
    channel(name: string, options?: { config?: { broadcast?: { self?: boolean } } }) {
      state.channelNames.push(name);
      state.selfBroadcast = options?.config?.broadcast?.self;
      return channel;
    },
    removeChannel() {
      state.removed += 1;
      return Promise.resolve('ok');
    },
  };

  return { client: client as unknown as SupabaseClient, state };
}

function helloMessage(): ProtocolMessage {
  return createMessage(
    {
      sessionId: SESSION_ID,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      newId: () => '22222222-2222-4222-8222-222222222222',
    },
    'HELLO',
    { role: 'PHONE', client_version: '1.0.0' },
  );
}

describe('channel naming', () => {
  it('scopes the channel to one session', () => {
    expect(sessionChannelName(SESSION_ID)).toBe(`session:${SESSION_ID}`);
  });

  it('gives different sessions different channels', () => {
    expect(sessionChannelName('a')).not.toBe(sessionChannelName('b'));
  });
});

describe('status mapping', () => {
  it('distinguishes a deliberate close from a failure', () => {
    expect(toTransportStatus('CLOSED')).toBe('CLOSED');
    expect(toTransportStatus('CHANNEL_ERROR')).toBe('ERRORED');
  });

  it('treats a timeout as recoverable', () => {
    expect(toTransportStatus('TIMED_OUT')).toBe('RECONNECTING');
  });

  it('reports a subscribed channel as connected', () => {
    expect(toTransportStatus('SUBSCRIBED')).toBe('CONNECTED');
  });
});

describe('connecting', () => {
  it('subscribes to the session channel and reports connected', async () => {
    const { client, state } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });

    const seen: string[] = [];
    transport.onStatusChange((status) => seen.push(status));

    await transport.connect();

    expect(state.channelNames).toEqual([`session:${SESSION_ID}`]);
    expect(transport.status).toBe('CONNECTED');
    expect(seen).toEqual(['CONNECTING', 'CONNECTED']);
  });

  it('does not echo a sender its own messages', async () => {
    const { client, state } = createFakeClient();
    await new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID }).connect();

    expect(state.selfBroadcast).toBe(false);
  });

  it('resolves rather than hanging when the channel errors', async () => {
    const { client } = createFakeClient('CHANNEL_ERROR');
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });

    await transport.connect();

    expect(transport.status).toBe('ERRORED');
  });

  it('opens only one channel if connect is called twice', async () => {
    const { client, state } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });

    await transport.connect();
    await transport.connect();

    expect(state.channelNames).toHaveLength(1);
  });
});

describe('receiving', () => {
  it('delivers a valid message', async () => {
    const { client, state } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });
    await transport.connect();

    const received: ProtocolMessage[] = [];
    transport.onMessage((message) => received.push(message));

    state.handler?.({ payload: helloMessage() });

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('HELLO');
  });

  it('reports a malformed message instead of delivering or throwing it', async () => {
    const { client, state } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });
    await transport.connect();

    const received: ProtocolMessage[] = [];
    const errors: string[] = [];
    transport.onMessage((message) => received.push(message));
    transport.onDecodeError((error) => errors.push(error.code));

    expect(() => {
      state.handler?.({ payload: { protocol_version: PROTOCOL_VERSION, type: 'HELLO' } });
    }).not.toThrow();

    expect(received).toHaveLength(0);
    expect(errors).toEqual(['INVALID_MESSAGE']);
  });

  it('separates an unsupported version from a malformed message', async () => {
    const { client, state } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });
    await transport.connect();

    const errors: string[] = [];
    transport.onDecodeError((error) => errors.push(error.code));

    state.handler?.({ payload: { ...helloMessage(), protocol_version: PROTOCOL_VERSION + 1 } });

    expect(errors).toEqual(['UNSUPPORTED_VERSION']);
  });

  it('stops delivering to a handler that unsubscribed', async () => {
    const { client, state } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });
    await transport.connect();

    const received: ProtocolMessage[] = [];
    const unsubscribe = transport.onMessage((message) => received.push(message));
    unsubscribe();

    state.handler?.({ payload: helloMessage() });

    expect(received).toHaveLength(0);
  });
});

describe('sending', () => {
  it('refuses to send before connecting', async () => {
    const { client } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });

    await expect(transport.send(helloMessage())).rejects.toThrow('IDLE');
  });

  it('broadcasts the whole envelope', async () => {
    const { client, state } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });
    await transport.connect();

    const message = helloMessage();
    await transport.send(message);

    expect(state.sent).toEqual([{ type: 'broadcast', event: 'protocol', payload: message }]);
  });

  it('surfaces a failed broadcast', async () => {
    const { client, state } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });
    await transport.connect();
    state.sendResult = 'timed out';

    await expect(transport.send(helloMessage())).rejects.toThrow('timed out');
  });
});

describe('disconnecting', () => {
  it('removes the channel and reports closed', async () => {
    const { client, state } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });
    await transport.connect();

    await transport.disconnect();

    expect(state.removed).toBe(1);
    expect(transport.status).toBe('CLOSED');
  });

  it('drops handlers so a closed session cannot keep firing callbacks', async () => {
    const { client, state } = createFakeClient();
    const transport = new SupabaseRealtimeTransport({ client, sessionId: SESSION_ID });
    await transport.connect();

    const received: ProtocolMessage[] = [];
    transport.onMessage((message) => received.push(message));

    const handler = state.handler;
    await transport.disconnect();
    handler?.({ payload: helloMessage() });

    expect(received).toHaveLength(0);
  });
});
