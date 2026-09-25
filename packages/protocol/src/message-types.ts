export const MESSAGE_TYPES = [
  'HELLO',
  'HELLO_ACK',
  'SESSION_READY',
  'GARMENT_SELECTED',
  'SIZE_SELECTED',
  'COLOR_SELECTED',
  'GARMENT_APPLIED',
  'FAVORITE_ADDED',
  'AI_RECOMMENDATION_REQUESTED',
  'AI_RECOMMENDATION_READY',
  'SIZE_RECOMMENDATION_REQUESTED',
  'SIZE_RECOMMENDATION_READY',
  'CUSTOMER_REQUESTED',
  'SESSION_ENDED',
  'PING',
  'PONG',
  'ERROR',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

/** The two peers that exchange protocol messages within a session. */
export const PARTICIPANT_ROLES = ['MIRROR', 'PHONE'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

// Re-exported rather than redeclared. The canonical list is in
// `@mirrorfit/types` because the database has a matching enum and
// `@mirrorfit/validation` needs it too; keeping a second copy here is exactly
// the drift the schema-parity test exists to catch.
export { SESSION_END_REASONS, type SessionEndReason } from '@mirrorfit/types';

export const PROTOCOL_ERROR_CODES = [
  'INVALID_MESSAGE',
  'UNSUPPORTED_VERSION',
  'SESSION_NOT_ACTIVE',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];
