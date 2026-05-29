import { z } from 'zod';
import { ERROR_CODES, HANDSHAKE_REJECT_CODES } from './error-codes';

/**
 * Current ReUI protocol version (RFC-001 §3.1).
 *
 * Runtime performs a strict-equality check on `version`. Bumping this
 * value is a hard break — adding optional fields does NOT bump it.
 */
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

const versionSchema = z.literal(PROTOCOL_VERSION);

// ── Handshake ───────────────────────────────────────────────────────────────

export const handshakeSchema = z.object({
  type: z.literal('reui:handshake'),
  version: versionSchema,
  payload: z.object({
    pluginId: z.string().min(1),
    sdkVersion: z.string().min(1),
    capabilities: z.array(z.string()).optional(),
  }),
});
export type HandshakeMessage = z.infer<typeof handshakeSchema>;

export const handshakeAckPayloadSchema = z.object({
  sessionId: z.string().min(1),
  pluginId: z.string().min(1),
  runtimeOrigin: z.string().min(1),
  permissions: z.array(z.string()),
  config: z.object({
    layer: z.string(),
    allowedEvents: z.array(z.string()),
  }),
});
export type HandshakeAckPayload = z.infer<typeof handshakeAckPayloadSchema>;

export const handshakeAckSchema = z.object({
  type: z.literal('reui:handshake-ack'),
  version: versionSchema,
  payload: handshakeAckPayloadSchema,
});
export type HandshakeAckMessage = z.infer<typeof handshakeAckSchema>;

export const handshakeRejectSchema = z.object({
  type: z.literal('reui:handshake-reject'),
  version: versionSchema,
  payload: z.object({
    reason: z.string(),
    code: z.enum(HANDSHAKE_REJECT_CODES),
  }),
});
export type HandshakeRejectMessage = z.infer<typeof handshakeRejectSchema>;

// ── Request / Response ─────────────────────────────────────────────────────

export const requestSchema = z.object({
  type: z.literal('reui:request'),
  version: versionSchema,
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type RequestMessage = z.infer<typeof requestSchema>;

export const successResponseSchema = z.object({
  type: z.literal('reui:response'),
  version: versionSchema,
  id: z.string().min(1),
  success: z.literal(true),
  result: z.unknown(),
});
export type SuccessResponseMessage = z.infer<typeof successResponseSchema>;

export const errorResponseSchema = z.object({
  type: z.literal('reui:response'),
  version: versionSchema,
  id: z.string().min(1),
  success: z.literal(false),
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponseMessage = z.infer<typeof errorResponseSchema>;

export const responseSchema = z.discriminatedUnion('success', [
  successResponseSchema,
  errorResponseSchema,
]);
export type ResponseMessage = z.infer<typeof responseSchema>;

// ── Push / Notify ──────────────────────────────────────────────────────────

export const pushSchema = z.object({
  type: z.literal('reui:push'),
  version: versionSchema,
  event: z.string().min(1),
  payload: z.unknown(),
});
export type PushMessage = z.infer<typeof pushSchema>;

export const notifySchema = z.object({
  type: z.literal('reui:notify'),
  version: versionSchema,
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type NotifyMessage = z.infer<typeof notifySchema>;

// ── Heartbeat ───────────────────────────────────────────────────────────────

export const pingSchema = z.object({
  type: z.literal('reui:ping'),
  version: versionSchema,
  timestamp: z.number(),
});
export type PingMessage = z.infer<typeof pingSchema>;

export const pongSchema = z.object({
  type: z.literal('reui:pong'),
  version: versionSchema,
  pluginId: z.string().min(1),
  timestamp: z.number(),
});
export type PongMessage = z.infer<typeof pongSchema>;

// ── Aggregate ───────────────────────────────────────────────────────────────

/**
 * Union of every known RFC-001 message. Use this in contract tests to
 * assert that everything sent on the wire is well-formed.
 *
 * `z.union` is used (rather than `z.discriminatedUnion('type')`) because
 * `reui:response` appears twice — once in success form, once in error
 * form — discriminated by the `success` boolean within `responseSchema`.
 */
export const anyMessageSchema = z.union([
  handshakeSchema,
  handshakeAckSchema,
  handshakeRejectSchema,
  requestSchema,
  responseSchema,
  pushSchema,
  notifySchema,
  pingSchema,
  pongSchema,
]);
export type AnyMessage = z.infer<typeof anyMessageSchema>;
