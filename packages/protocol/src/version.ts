/**
 * Wire protocol version.
 *
 * A mirror in a store and the phone that pairs with it are updated on
 * different schedules, so every message carries its version and a receiver
 * rejects anything it does not understand rather than guessing. Bump this only
 * for breaking envelope or payload changes.
 */
export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
