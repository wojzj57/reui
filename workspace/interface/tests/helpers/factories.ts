/**
 * Known-valid sample factories for every RFC-001 message schema.
 *
 * Each test mutates one field of these samples to drive its own positive /
 * negative case. Centralizing the literals here keeps tests stable when the
 * protocol envelope changes.
 */

import type { z } from 'zod';
import {
  PROTOCOL_VERSION,
  handshakeSchema,
  handshakeAckSchema,
  handshakeRejectSchema,
  requestSchema,
  successResponseSchema,
  errorResponseSchema,
  pushSchema,
  notifySchema,
  pingSchema,
  pongSchema,
} from '../../src/protocol/messages';

export const handshake = (): z.infer<typeof handshakeSchema> => ({
  type: 'reui:handshake',
  version: PROTOCOL_VERSION,
  payload: {
    pluginId: 'plugin-a',
    sdkVersion: '0.0.0-test',
  },
});

export const handshakeAck = (): z.infer<typeof handshakeAckSchema> => ({
  type: 'reui:handshake-ack',
  version: PROTOCOL_VERSION,
  payload: {
    sessionId: 'session-1',
    pluginId: 'plugin-a',
    runtimeOrigin: 'https://runtime.reui.local',
    permissions: ['secure.write'],
    config: {
      layer: 'panel',
      allowedEvents: ['plugin:hello'],
    },
  },
});

export const handshakeReject = (): z.infer<typeof handshakeRejectSchema> => ({
  type: 'reui:handshake-reject',
  version: PROTOCOL_VERSION,
  payload: {
    reason: 'unknown plugin',
    code: 'UNKNOWN_PLUGIN',
  },
});

export const request = (): z.infer<typeof requestSchema> => ({
  type: 'reui:request',
  version: PROTOCOL_VERSION,
  id: 'plugin-a:1',
  method: 'http:request',
  params: { method: 'GET', url: '/api/x' },
});

export const successResponse = (): z.infer<typeof successResponseSchema> => ({
  type: 'reui:response',
  version: PROTOCOL_VERSION,
  id: 'plugin-a:1',
  success: true,
  result: { ok: true },
});

export const errorResponse = (): z.infer<typeof errorResponseSchema> => ({
  type: 'reui:response',
  version: PROTOCOL_VERSION,
  id: 'plugin-a:1',
  success: false,
  error: {
    code: 'TIMEOUT',
    message: 'no response in 5s',
  },
});

export const push = (): z.infer<typeof pushSchema> => ({
  type: 'reui:push',
  version: PROTOCOL_VERSION,
  event: 'event:hello',
  payload: { greeting: 'hi' },
});

export const notify = (): z.infer<typeof notifySchema> => ({
  type: 'reui:notify',
  version: PROTOCOL_VERSION,
  method: 'plugin:ready',
  params: undefined,
});

export const ping = (): z.infer<typeof pingSchema> => ({
  type: 'reui:ping',
  version: PROTOCOL_VERSION,
  timestamp: 1_700_000_000,
});

export const pong = (): z.infer<typeof pongSchema> => ({
  type: 'reui:pong',
  version: PROTOCOL_VERSION,
  pluginId: 'plugin-a',
  timestamp: 1_700_000_000,
});
