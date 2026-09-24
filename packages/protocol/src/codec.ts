import { toFieldIssues, type FieldIssue } from '@mirrorfit/validation';
import { z } from 'zod';
import type { MessageType, ProtocolErrorCode } from './message-types';
import {
  aiRecommendationReadyMessageSchema,
  aiRecommendationRequestedMessageSchema,
  colorSelectedMessageSchema,
  customerRequestedMessageSchema,
  errorMessageSchema,
  favoriteAddedMessageSchema,
  garmentAppliedMessageSchema,
  garmentSelectedMessageSchema,
  helloAckMessageSchema,
  helloMessageSchema,
  pingMessageSchema,
  pongMessageSchema,
  protocolMessageSchema,
  sessionEndedMessageSchema,
  sessionReadyMessageSchema,
  sizeRecommendationReadyMessageSchema,
  sizeRecommendationRequestedMessageSchema,
  sizeSelectedMessageSchema,
  type MessageOfType,
  type ProtocolMessage,
} from './messages';
import { PROTOCOL_VERSION } from './version';

export const MESSAGE_SCHEMAS = {
  HELLO: helloMessageSchema,
  HELLO_ACK: helloAckMessageSchema,
  SESSION_READY: sessionReadyMessageSchema,
  GARMENT_SELECTED: garmentSelectedMessageSchema,
  SIZE_SELECTED: sizeSelectedMessageSchema,
  COLOR_SELECTED: colorSelectedMessageSchema,
  GARMENT_APPLIED: garmentAppliedMessageSchema,
  FAVORITE_ADDED: favoriteAddedMessageSchema,
  AI_RECOMMENDATION_REQUESTED: aiRecommendationRequestedMessageSchema,
  AI_RECOMMENDATION_READY: aiRecommendationReadyMessageSchema,
  SIZE_RECOMMENDATION_REQUESTED: sizeRecommendationRequestedMessageSchema,
  SIZE_RECOMMENDATION_READY: sizeRecommendationReadyMessageSchema,
  CUSTOMER_REQUESTED: customerRequestedMessageSchema,
  SESSION_ENDED: sessionEndedMessageSchema,
  PING: pingMessageSchema,
  PONG: pongMessageSchema,
  ERROR: errorMessageSchema,
} as const satisfies Record<MessageType, z.ZodType>;

/** Payload as callers write it, before Zod applies defaults. */
export type PayloadInput<TType extends MessageType> = z.input<
  (typeof MESSAGE_SCHEMAS)[TType]
>['payload'];

export interface MessageContext {
  readonly sessionId: string;
  /** Injected so tests can produce deterministic envelopes. */
  readonly now: () => Date;
  readonly newId: () => string;
}

/**
 * Builds and validates an outgoing message.
 *
 * Validating on the send side means a malformed payload fails in the code that
 * produced it, rather than surfacing as a confusing decode error on the peer.
 */
export function createMessage<TType extends MessageType>(
  context: MessageContext,
  type: TType,
  payload: PayloadInput<TType>,
): MessageOfType<TType> {
  const candidate = {
    protocol_version: PROTOCOL_VERSION,
    message_id: context.newId(),
    session_id: context.sessionId,
    timestamp: context.now().toISOString(),
    type,
    payload,
  };

  // The generic relationship between `type` and its schema is sound but not
  // expressible to the compiler through the indexed union; the parse above
  // enforces it at runtime.
  return MESSAGE_SCHEMAS[type].parse(candidate) as MessageOfType<TType>;
}

export type DecodeResult =
  | { readonly ok: true; readonly message: ProtocolMessage }
  | {
      readonly ok: false;
      readonly code: Extract<ProtocolErrorCode, 'INVALID_MESSAGE' | 'UNSUPPORTED_VERSION'>;
      readonly issues: readonly FieldIssue[];
    };

const versionProbeSchema = z.object({ protocol_version: z.unknown() });

/**
 * Validates an untrusted inbound message.
 *
 * Version is checked before shape so that a peer running a future protocol
 * gets `UNSUPPORTED_VERSION` instead of a pile of confusing field errors.
 */
export function decodeMessage(raw: unknown): DecodeResult {
  const probe = versionProbeSchema.safeParse(raw);
  if (probe.success && probe.data.protocol_version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_VERSION',
      issues: [
        {
          path: 'protocol_version',
          message: `Unsupported protocol version; this peer speaks version ${String(PROTOCOL_VERSION)}`,
        },
      ],
    };
  }

  const result = protocolMessageSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, message: result.data };
  }
  return { ok: false, code: 'INVALID_MESSAGE', issues: toFieldIssues(result.error) };
}

export function isMessageOfType<TType extends MessageType>(
  message: ProtocolMessage,
  type: TType,
): message is MessageOfType<TType> {
  return message.type === type;
}
