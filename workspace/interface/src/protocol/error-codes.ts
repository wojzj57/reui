/**
 * RFC-001 §4.2 Error Codes — single source of truth.
 *
 * Any new error code must be added here AND covered by at least one
 * integration test in @reui/core (per docs/plans/01-core-test-plan.md §8.4).
 */
export const ERROR_CODES = [
  'TIMEOUT',
  'NOT_READY',
  'PERMISSION_DENIED',
  'CAPABILITY_DENIED',
  'METHOD_NOT_FOUND',
  'INVALID_PARAMS',
  'VERSION_MISMATCH',
  'RUNTIME_ERROR',
  'NETWORK_ERROR',
  'PLUGIN_NOT_FOUND',
  'EVENT_DENIED',
  'HANDSHAKE_REJECTED',
  'UNKNOWN_PLUGIN',
  'PAYLOAD_TOO_LARGE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Subset of {@link ERROR_CODES} that may appear in a `reui:handshake-reject`
 * payload (RFC-001 §3.6).
 *
 * ## Relationship to `HANDSHAKE_REJECTED` in {@link ERROR_CODES}
 *
 * - `HANDSHAKE_REJECTED` (in {@link ERROR_CODES}) is the **outward** ErrorCode
 *   that the `@reui/core` SDK uses when wrapping a `reui:handshake-reject`
 *   message into a `ReUIError` thrown to the plugin author. It is the SDK's
 *   stable, single-name signal that "the runtime denied my handshake."
 * - `HANDSHAKE_REJECT_CODES` (the 3 codes below) are the **inward** payload
 *   codes that may appear inside `reui:handshake-reject.payload.code`. They
 *   describe *why* the runtime rejected the handshake.
 *
 * The two spaces overlap by design: `UNKNOWN_PLUGIN`, `VERSION_MISMATCH`, and
 * `PERMISSION_DENIED` are valid error codes in both directions. The SDK
 * preserves the original payload code in `ReUIError.details` so callers can
 * read both the outward `HANDSHAKE_REJECTED` and the inward reason.
 */
export const HANDSHAKE_REJECT_CODES = [
  'UNKNOWN_PLUGIN',
  'VERSION_MISMATCH',
  'PERMISSION_DENIED',
] as const;

export type HandshakeRejectCode = (typeof HANDSHAKE_REJECT_CODES)[number];
