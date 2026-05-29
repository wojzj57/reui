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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Subset of ERROR_CODES that may appear in a `reui:handshake-reject` payload. */
export const HANDSHAKE_REJECT_CODES = [
  'UNKNOWN_PLUGIN',
  'VERSION_MISMATCH',
  'PERMISSION_DENIED',
] as const;

export type HandshakeRejectCode = (typeof HANDSHAKE_REJECT_CODES)[number];
