import {
  confidenceSchema,
  isoTimestampSchema,
  shortTextSchema,
  sizeLabelSchema,
  uuidSchema,
  semverSchema,
  nonNegativeNumberSchema,
} from '@mirrorfit/validation';
import { z } from 'zod';
import {
  PROTOCOL_ERROR_CODES,
  PARTICIPANT_ROLES,
  SESSION_END_REASONS,
  type MessageType,
} from './message-types';
import { PROTOCOL_VERSION } from './version';

/**
 * Fields present on every message regardless of type.
 *
 * Field names are snake_case to match the database and the wire format, so a
 * message can be persisted as a `session_events` row without remapping.
 */
export const envelopeBaseSchema = z.object({
  protocol_version: z.literal(PROTOCOL_VERSION),
  message_id: uuidSchema,
  session_id: uuidSchema,
  timestamp: isoTimestampSchema,
});

function defineMessage<TType extends MessageType, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) {
  return envelopeBaseSchema.extend({
    type: z.literal(type),
    payload,
  });
}

const colorSchema = z.object({
  name: shortTextSchema,
  hex: z.string().regex(/^#[0-9a-f]{6}$/i, 'must be a hex color'),
});

/** Identifies a specific purchasable item: a garment in one colourway. */
const variantRefSchema = z.object({
  garment_id: uuidSchema,
  variant_id: uuidSchema,
});

export const helloMessageSchema = defineMessage(
  'HELLO',
  z.object({
    role: z.enum(PARTICIPANT_ROLES),
    client_version: semverSchema,
    /** Free-form capability flags so a newer peer can degrade gracefully. */
    capabilities: z.array(shortTextSchema).max(32).default([]),
  }),
);

export const helloAckMessageSchema = defineMessage(
  'HELLO_ACK',
  z.object({
    role: z.enum(PARTICIPANT_ROLES),
    client_version: semverSchema,
  }),
);

export const sessionReadyMessageSchema = defineMessage(
  'SESSION_READY',
  z.object({
    shop_id: uuidSchema,
    display_id: uuidSchema,
  }),
);

export const garmentSelectedMessageSchema = defineMessage('GARMENT_SELECTED', variantRefSchema);

export const sizeSelectedMessageSchema = defineMessage(
  'SIZE_SELECTED',
  variantRefSchema.extend({
    size_label: sizeLabelSchema,
    /** True when the customer overrode an AI suggestion. Tracked for tuning. */
    manual_override: z.boolean().default(false),
  }),
);

export const colorSelectedMessageSchema = defineMessage(
  'COLOR_SELECTED',
  variantRefSchema.extend({ color: colorSchema }),
);

export const garmentAppliedMessageSchema = defineMessage(
  'GARMENT_APPLIED',
  variantRefSchema.extend({
    /**
     * Mirror-measured time from receiving GARMENT_SELECTED to the first frame
     * rendered with the garment. This is the p95 selection-to-visible metric;
     * it is reported by the renderer, never estimated.
     */
    apply_latency_ms: nonNegativeNumberSchema,
    from_cache: z.boolean(),
  }),
);

export const favoriteAddedMessageSchema = defineMessage('FAVORITE_ADDED', variantRefSchema);

export const aiRecommendationRequestedMessageSchema = defineMessage(
  'AI_RECOMMENDATION_REQUESTED',
  z.object({
    request_id: uuidSchema,
    category: shortTextSchema.optional(),
    /** Variants the customer already engaged with, as recommendation context. */
    seed_variant_ids: z.array(uuidSchema).max(20).default([]),
  }),
);

export const aiRecommendationReadyMessageSchema = defineMessage(
  'AI_RECOMMENDATION_READY',
  z.object({
    request_id: uuidSchema,
    recommendations: z
      .array(
        variantRefSchema.extend({
          score: confidenceSchema,
          /** Shown to the customer as "Suggested because ...". */
          reason: shortTextSchema,
        }),
      )
      .max(50),
  }),
);

export const sizeRecommendationRequestedMessageSchema = defineMessage(
  'SIZE_RECOMMENDATION_REQUESTED',
  z.object({
    request_id: uuidSchema,
    ...variantRefSchema.shape,
  }),
);

export const sizeRecommendationReadyMessageSchema = defineMessage(
  'SIZE_RECOMMENDATION_READY',
  z.object({
    request_id: uuidSchema,
    ...variantRefSchema.shape,
    recommended_size: sizeLabelSchema,
    /** Never presented as a measurement; always surfaced as a suggestion. */
    confidence: confidenceSchema,
    alternatives: z.array(sizeLabelSchema).max(6).default([]),
    rationale: shortTextSchema.optional(),
  }),
);

export const customerRequestedMessageSchema = defineMessage(
  'CUSTOMER_REQUESTED',
  z.object({
    request_id: uuidSchema,
    ...variantRefSchema.shape,
    size_label: sizeLabelSchema,
  }),
);

export const sessionEndedMessageSchema = defineMessage(
  'SESSION_ENDED',
  z.object({
    reason: z.enum(SESSION_END_REASONS),
  }),
);

export const pingMessageSchema = defineMessage('PING', z.object({ sent_at: isoTimestampSchema }));

export const pongMessageSchema = defineMessage(
  'PONG',
  z.object({
    /** Echoed from the PING so the sender can compute round-trip latency. */
    sent_at: isoTimestampSchema,
    replied_at: isoTimestampSchema,
  }),
);

export const errorMessageSchema = defineMessage(
  'ERROR',
  z.object({
    code: z.enum(PROTOCOL_ERROR_CODES),
    message: shortTextSchema,
    retryable: z.boolean(),
  }),
);

export const protocolMessageSchema = z.discriminatedUnion('type', [
  helloMessageSchema,
  helloAckMessageSchema,
  sessionReadyMessageSchema,
  garmentSelectedMessageSchema,
  sizeSelectedMessageSchema,
  colorSelectedMessageSchema,
  garmentAppliedMessageSchema,
  favoriteAddedMessageSchema,
  aiRecommendationRequestedMessageSchema,
  aiRecommendationReadyMessageSchema,
  sizeRecommendationRequestedMessageSchema,
  sizeRecommendationReadyMessageSchema,
  customerRequestedMessageSchema,
  sessionEndedMessageSchema,
  pingMessageSchema,
  pongMessageSchema,
  errorMessageSchema,
]);

export type ProtocolMessage = z.infer<typeof protocolMessageSchema>;

export type MessageOfType<TType extends MessageType> = Extract<ProtocolMessage, { type: TType }>;

export type PayloadOfType<TType extends MessageType> = MessageOfType<TType>['payload'];
