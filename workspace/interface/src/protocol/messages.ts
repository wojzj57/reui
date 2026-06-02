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

// ── Event namespaces (RFC-001 §3.1) ────────────────────────────────────────

/**
 * RFC-001 §3.1: every push event must start with one of these prefixes.
 *
 * This list is the protocol source-of-truth. Runtime's `event-namespace.ts`
 * re-exports it as `KNOWN_NAMESPACES` so internal helpers (`parseEventName`,
 * `isKnownNamespace`) consume a single canonical constant.
 */
export const EVENT_NAMESPACES = ['event', 'nui', 'ws', 'auth', 'plugin'] as const;
export type EventNamespace = (typeof EVENT_NAMESPACES)[number];
const eventNamePattern = new RegExp(`^(${EVENT_NAMESPACES.join('|')}):.+`);

// ── Method registry (RFC-001 §4.1) ─────────────────────────────────────────

/**
 * RFC-001 §4.1: every PostMessageRouter request method.
 *
 * Used by {@link strictRequestSchema} to enforce the allowlist on request
 * paths whose method names are known at compile time. Notify methods
 * (RFC-007) are intentionally excluded from this list.
 */
export const KNOWN_METHODS = [
  'event:subscribe',
  'event:unsubscribe',
  'event:emit',
  'http:request',
  'ws:send',
  'ws:state',
  'auth:getUser',
  'auth:hasPermission',
  'auth:checkPermissions',
  'nui:send',
  'plugin:getConfig',
  'plugin:show',
  'plugin:hide',
  'plugin:ready',
  'plugin:saveState',
  'plugin:restoreState',
] as const;
export type KnownMethod = (typeof KNOWN_METHODS)[number];

// ── Message ID format (RFC-001 §3.1 / appendix B) ──────────────────────────

/**
 * Request / response correlation id format.
 *
 * RFC-001 §3.1 mandates `{pluginId}:{sequence}`, where `sequence` is a
 * monotonically increasing integer. The matching production code is at
 * `core/src/client.ts` (`Client.nextRequestId`).
 */
const messageIdPattern = /^[^:\s]+:\d+$/;

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
  permissions: z.array(z.string().min(1)),
  config: z.object({
    layer: z.string(),
    allowedEvents: z.array(z.string().min(1)),
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

/**
 * RFC-001 §3.1 request envelope.
 *
 * `params` is optional: when undefined, callers should OMIT the field from
 * the serialized message rather than serializing `params: undefined`.
 * Tests that need to assert `params` presence/absence must use
 * `expect.objectContaining({ params })` or check `'params' in msg`, not
 * `toEqual` against an object literal.
 *
 * `method` is loose (`z.string().min(1)`) to keep the SDK forward-compatible
 * with future methods. Use {@link strictRequestSchema} on validation paths
 * whose method registry is known at compile time.
 */
export const requestSchema = z.object({
  type: z.literal('reui:request'),
  version: versionSchema,
  id: z
    .string()
    .regex(messageIdPattern, 'id must match {pluginId}:{sequence}'),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type RequestMessage = z.infer<typeof requestSchema>;

/**
 * Strict variant of {@link requestSchema}: rejects request methods that
 * are not in {@link KNOWN_METHODS}. Use this on paths where the method
 * registry is fully known (e.g. {@link strictAnyMessageSchema}).
 */
export const strictRequestSchema = requestSchema.extend({
  method: z.enum(KNOWN_METHODS),
});
export type StrictRequestMessage = z.infer<typeof strictRequestSchema>;

export const successResponseSchema = z.object({
  type: z.literal('reui:response'),
  version: versionSchema,
  id: z
    .string()
    .regex(messageIdPattern, 'id must match {pluginId}:{sequence}'),
  success: z.literal(true),
  result: z.unknown(),
});
export type SuccessResponseMessage = z.infer<typeof successResponseSchema>;

export const errorResponseSchema = z.object({
  type: z.literal('reui:response'),
  version: versionSchema,
  id: z
    .string()
    .regex(messageIdPattern, 'id must match {pluginId}:{sequence}'),
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
  event: z
    .string()
    .regex(
      eventNamePattern,
      'event must start with a known namespace prefix (event:|nui:|ws:|auth:|plugin:)',
    ),
  payload: z.unknown(),
});
export type PushMessage = z.infer<typeof pushSchema>;

/**
 * Notify methods are intentionally loose to accommodate plugin-defined
 * methods (RFC-007 — `exports:invoke` and friends). Use
 * {@link strictRequestSchema} only for request paths whose method names
 * are known at compile time.
 *
 * `params` follows the same omitted-when-undefined contract as
 * {@link requestSchema}.
 */
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

/**
 * Strict variant of {@link anyMessageSchema}: rejects unknown top-level
 * fields on every shape AND enforces the {@link KNOWN_METHODS} allowlist
 * on request envelopes. Useful for fuzz/forge tests where any extra field
 * indicates a forged message.
 */
export const strictAnyMessageSchema = z.union([
  handshakeSchema.strict(),
  handshakeAckSchema.strict(),
  handshakeRejectSchema.strict(),
  strictRequestSchema.strict(),
  successResponseSchema.strict(),
  errorResponseSchema.strict(),
  pushSchema.strict(),
  notifySchema.strict(),
  pingSchema.strict(),
  pongSchema.strict(),
]);
