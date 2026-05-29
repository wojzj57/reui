import type {
  HandshakeMessage,
  HandshakeAckMessage,
  HandshakeAckPayload,
  HandshakeRejectMessage,
  HandshakeRejectCode,
  RequestMessage,
  SuccessResponseMessage,
  ErrorResponseMessage,
  PushMessage,
  PingMessage,
  PongMessage,
  ErrorCode,
} from '@reui/interface';
import { PROTOCOL_VERSION } from '@reui/interface';

/**
 * Protocol message factories.
 *
 * Per docs/plans/01-core-test-plan.md §7.7, every protocol message used in
 * a test MUST be constructed through one of these factories — never
 * hand-rolled object literals — so that field renames in RFC-001 break
 * tests at the factory boundary instead of scattered call sites.
 */

const v = PROTOCOL_VERSION;

export const makeHandshake = (
  over: Partial<HandshakeMessage['payload']> = {},
): HandshakeMessage => ({
  type: 'reui:handshake',
  version: v,
  payload: {
    pluginId: 'test-plugin',
    sdkVersion: '0.0.0-test',
    ...over,
  },
});

export const makeAckPayload = (
  over: Partial<HandshakeAckPayload> = {},
): HandshakeAckPayload => ({
  sessionId: 'session-1',
  pluginId: 'test-plugin',
  runtimeOrigin: 'https://runtime.reui.local',
  permissions: [],
  config: { layer: 'panel', allowedEvents: [] },
  ...over,
});

export const makeAck = (
  over: Partial<HandshakeAckPayload> = {},
): HandshakeAckMessage => ({
  type: 'reui:handshake-ack',
  version: v,
  payload: makeAckPayload(over),
});

export const makeReject = (
  code: HandshakeRejectCode = 'UNKNOWN_PLUGIN',
  reason = 'rejected by test',
): HandshakeRejectMessage => ({
  type: 'reui:handshake-reject',
  version: v,
  payload: { code, reason },
});

export const makeRequest = (
  over: Partial<Omit<RequestMessage, 'type' | 'version'>> = {},
): RequestMessage => ({
  type: 'reui:request',
  version: v,
  id: 'test-plugin:1',
  method: 'noop',
  ...over,
});

export const makeSuccessResponse = (
  id: string,
  result: unknown = null,
): SuccessResponseMessage => ({
  type: 'reui:response',
  version: v,
  id,
  success: true,
  result,
});

export const makeErrorResponse = (
  id: string,
  code: ErrorCode,
  message = `error:${code}`,
  details?: unknown,
): ErrorResponseMessage => ({
  type: 'reui:response',
  version: v,
  id,
  success: false,
  error: details === undefined ? { code, message } : { code, message, details },
});

export const makePush = (event: string, payload: unknown = null): PushMessage => ({
  type: 'reui:push',
  version: v,
  event,
  payload,
});

export const makePing = (timestamp = 0): PingMessage => ({
  type: 'reui:ping',
  version: v,
  timestamp,
});

export const makePong = (
  pluginId: string,
  timestamp = 0,
): PongMessage => ({
  type: 'reui:pong',
  version: v,
  pluginId,
  timestamp,
});
