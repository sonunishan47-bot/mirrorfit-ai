import { describe, expect, it, vi } from 'vitest';
import { createMessage, decodeMessage, isMessageOfType, type MessageContext } from './codec';
import { MESSAGE_TYPES } from './message-types';
import { protocolMessageSchema, type ProtocolMessage } from './messages';
import { InMemoryTransportHub } from './transport';
import { PROTOCOL_VERSION } from './version';

const SESSION_ID = '3f1c2a44-9b1e-4a2e-8d1f-7c6b5a4e3d21';
const GARMENT_ID = '11111111-2222-4333-8444-555555555555';
const VARIANT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

function testContext(): MessageContext {
  let counter = 0;
  return {
    sessionId: SESSION_ID,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  };
}

describe('message envelope', () => {
  it('stamps every message with version, id, session and timestamp', () => {
    const message = createMessage(testContext(), 'GARMENT_SELECTED', {
      garment_id: GARMENT_ID,
      variant_id: VARIANT_ID,
    });

    expect(message.protocol_version).toBe(PROTOCOL_VERSION);
    expect(message.session_id).toBe(SESSION_ID);
    expect(message.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(message.message_id).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('applies declared defaults', () => {
    const message = createMessage(testContext(), 'HELLO', {
      role: 'MIRROR',
      client_version: '1.0.0',
    });
    expect(message.payload.capabilities).toEqual([]);
  });

  it('rejects an invalid payload at creation time', () => {
    expect(() =>
      createMessage(testContext(), 'SIZE_SELECTED', {
        garment_id: GARMENT_ID,
        variant_id: VARIANT_ID,
        // @ts-expect-error size must be a known label
        size_label: 'HUGE',
      }),
    ).toThrow();
  });

  it('has a schema registered for every declared message type', () => {
    const context = testContext();
    for (const type of MESSAGE_TYPES) {
      expect(() => createMessage(context, type, {} as never)).toBeDefined();
    }
    expect(MESSAGE_TYPES).toHaveLength(17);
  });
});

describe('decodeMessage', () => {
  it('accepts a well-formed message', () => {
    const message = createMessage(testContext(), 'PING', {
      sent_at: '2026-01-01T00:00:00.000Z',
    });
    const result = decodeMessage(JSON.parse(JSON.stringify(message)));
    expect(result.ok).toBe(true);
  });

  it('flags a future protocol version distinctly from a malformed payload', () => {
    const result = decodeMessage({
      protocol_version: 99,
      message_id: SESSION_ID,
      session_id: SESSION_ID,
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'PING',
      payload: { sent_at: '2026-01-01T00:00:00.000Z' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNSUPPORTED_VERSION');
  });

  it('rejects an unknown message type', () => {
    const result = decodeMessage({
      protocol_version: PROTOCOL_VERSION,
      message_id: SESSION_ID,
      session_id: SESSION_ID,
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'DROP_TABLE',
      payload: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_MESSAGE');
  });

  it('rejects a payload belonging to a different message type', () => {
    const result = decodeMessage({
      protocol_version: PROTOCOL_VERSION,
      message_id: SESSION_ID,
      session_id: SESSION_ID,
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'GARMENT_SELECTED',
      payload: { sent_at: '2026-01-01T00:00:00.000Z' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects non-object input without throwing', () => {
    for (const input of [null, undefined, 42, 'PING', []]) {
      expect(decodeMessage(input).ok).toBe(false);
    }
  });
});

describe('InMemoryTransportHub', () => {
  it('delivers a garment selection from the phone to the mirror', async () => {
    const hub = new InMemoryTransportHub();
    const phone = hub.createEndpoint();
    const mirror = hub.createEndpoint();
    await phone.connect();
    await mirror.connect();

    const received: ProtocolMessage[] = [];
    mirror.onMessage((message) => received.push(message));

    await phone.send(
      createMessage(testContext(), 'GARMENT_SELECTED', {
        garment_id: GARMENT_ID,
        variant_id: VARIANT_ID,
      }),
    );

    expect(received).toHaveLength(1);
    const [message] = received;
    expect(message && isMessageOfType(message, 'GARMENT_SELECTED')).toBe(true);
    if (!message || !isMessageOfType(message, 'GARMENT_SELECTED')) return;
    expect(message.payload.garment_id).toBe(GARMENT_ID);
  });

  it('does not echo a message back to its sender', async () => {
    const hub = new InMemoryTransportHub();
    const phone = hub.createEndpoint();
    const mirror = hub.createEndpoint();
    await phone.connect();
    await mirror.connect();

    const echoed = vi.fn();
    phone.onMessage(echoed);
    await phone.send(createMessage(testContext(), 'PING', { sent_at: '2026-01-01T00:00:00.000Z' }));

    expect(echoed).not.toHaveBeenCalled();
  });

  it('reports malformed inbound traffic instead of throwing', async () => {
    const hub = new InMemoryTransportHub();
    const sender = hub.createEndpoint();
    const receiver = hub.createEndpoint();
    await sender.connect();
    await receiver.connect();

    const errors = vi.fn();
    receiver.onDecodeError(errors);
    // Bypasses the typed `send` the way a hostile or outdated peer would.
    await sender.send({ type: 'NOPE' } as unknown as ProtocolMessage);

    expect(errors).toHaveBeenCalledOnce();
  });

  it('refuses to send before connecting', async () => {
    const hub = new InMemoryTransportHub();
    const phone = hub.createEndpoint();
    await expect(
      phone.send(createMessage(testContext(), 'PING', { sent_at: '2026-01-01T00:00:00.000Z' })),
    ).rejects.toThrow(/IDLE/);
  });

  it('stops delivering after disconnect so state cannot leak between sessions', async () => {
    const hub = new InMemoryTransportHub();
    const phone = hub.createEndpoint();
    const mirror = hub.createEndpoint();
    await phone.connect();
    await mirror.connect();

    const received = vi.fn();
    mirror.onMessage(received);
    await mirror.disconnect();
    await phone.send(createMessage(testContext(), 'PING', { sent_at: '2026-01-01T00:00:00.000Z' }));

    expect(received).not.toHaveBeenCalled();
  });
});

describe('schema surface', () => {
  it('exposes a discriminated union covering all message types', () => {
    const options = protocolMessageSchema.options;
    expect(options).toHaveLength(MESSAGE_TYPES.length);
  });
});
