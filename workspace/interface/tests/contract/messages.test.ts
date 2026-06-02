import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  KNOWN_METHODS,
  EVENT_NAMESPACES,
  handshakeSchema,
  handshakeAckSchema,
  handshakeRejectSchema,
  requestSchema,
  strictRequestSchema,
  successResponseSchema,
  errorResponseSchema,
  pushSchema,
  notifySchema,
  pingSchema,
  pongSchema,
  anyMessageSchema,
  strictAnyMessageSchema,
} from '../../src/protocol/messages';
import * as fx from '../helpers/factories';

describe('handshakeSchema.envelope', () => {
  it('should accept the canonical handshake sample when all required fields are present', () => {
    // arrange
    const msg = fx.handshake();

    // act
    const result = handshakeSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });

  it('should reject when version is not the protocol literal', () => {
    // arrange
    const msg = { ...fx.handshake(), version: 2 };

    // act
    const result = handshakeSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });

  it('should reject when payload.pluginId is missing', () => {
    // arrange
    const msg = fx.handshake();
    const broken = { ...msg, payload: { sdkVersion: msg.payload.sdkVersion } };

    // act
    const result = handshakeSchema.safeParse(broken);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('handshakeAckSchema.envelope', () => {
  it('should accept a happy ack with non-empty permissions and allowedEvents', () => {
    // arrange
    const msg = fx.handshakeAck();

    // act
    const result = handshakeAckSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });

  it('should reject when permissions contains an empty string', () => {
    // arrange
    const msg = fx.handshakeAck();
    const broken = {
      ...msg,
      payload: { ...msg.payload, permissions: [''] },
    };

    // act
    const result = handshakeAckSchema.safeParse(broken);

    // assert
    expect(result.success).toBe(false);
  });

  it('should reject when config.allowedEvents contains an empty string', () => {
    // arrange
    const msg = fx.handshakeAck();
    const broken = {
      ...msg,
      payload: {
        ...msg.payload,
        config: { ...msg.payload.config, allowedEvents: [''] },
      },
    };

    // act
    const result = handshakeAckSchema.safeParse(broken);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('handshakeRejectSchema.envelope', () => {
  it('should accept when payload.code is one of the handshake reject codes', () => {
    // arrange
    const msg = fx.handshakeReject();

    // act
    const result = handshakeRejectSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });

  it('should reject when payload.code is not in the handshake-reject subset', () => {
    // arrange
    const msg = fx.handshakeReject();
    const broken = { ...msg, payload: { ...msg.payload, code: 'TIMEOUT' } };

    // act
    const result = handshakeRejectSchema.safeParse(broken);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('requestSchema.id', () => {
  it('should accept the canonical {plugin}:{sequence} format', () => {
    // arrange
    const msg = fx.request();

    // act
    const result = requestSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });

  it('should reject when id is a UUID (no colon)', () => {
    // arrange
    const msg = { ...fx.request(), id: '550e8400-e29b-41d4-a716-446655440000' };

    // act
    const result = requestSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });

  it('should reject when id has no digit suffix', () => {
    // arrange
    const msg = { ...fx.request(), id: 'plugin-a:abc' };

    // act
    const result = requestSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });

  it('should reject when id is missing the colon separator', () => {
    // arrange
    const msg = { ...fx.request(), id: 'plugin-a-1' };

    // act
    const result = requestSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('requestSchema.envelope', () => {
  it('should reject when version is not the protocol literal', () => {
    // arrange
    const msg = { ...fx.request(), version: 2 };

    // act
    const result = requestSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });

  it('should accept loose method names for forward-compat', () => {
    // arrange — method that is not in KNOWN_METHODS is still valid loose
    const msg = { ...fx.request(), method: 'exports:custom.fn' };

    // act
    const result = requestSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });
});

describe('strictRequestSchema.method', () => {
  it('should accept methods listed in KNOWN_METHODS', () => {
    // arrange
    const msg = { ...fx.request(), method: 'http:request' };

    // act
    const result = strictRequestSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });

  it('should reject typos of known methods', () => {
    // arrange
    const msg = { ...fx.request(), method: 'http:requst' };

    // act
    const result = strictRequestSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });

  it('should reject plugin-defined methods that are not in KNOWN_METHODS', () => {
    // arrange
    const msg = { ...fx.request(), method: 'someCustom:method' };

    // act
    const result = strictRequestSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('successResponseSchema.envelope', () => {
  it('should accept a happy success response', () => {
    // arrange
    const msg = fx.successResponse();

    // act
    const result = successResponseSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });

  it('should reject when id does not match the {plugin}:{seq} pattern', () => {
    // arrange
    const msg = { ...fx.successResponse(), id: 'no-such-id' };

    // act
    const result = successResponseSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('errorResponseSchema.envelope', () => {
  it('should accept an error response with a known error code', () => {
    // arrange
    const msg = fx.errorResponse();

    // act
    const result = errorResponseSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });

  it('should reject when error.code is not in ERROR_CODES', () => {
    // arrange
    const msg = fx.errorResponse();
    const broken = { ...msg, error: { ...msg.error, code: 'TEAPOT' } };

    // act
    const result = errorResponseSchema.safeParse(broken);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('pushSchema.event', () => {
  it.each(EVENT_NAMESPACES)(
    'should accept event names with the "%s" namespace',
    (ns) => {
      // arrange
      const msg = { ...fx.push(), event: `${ns}:demo` };

      // act
      const result = pushSchema.safeParse(msg);

      // assert
      expect(result.success).toBe(true);
    },
  );

  it('should reject when event has no namespace prefix', () => {
    // arrange
    const msg = { ...fx.push(), event: 'foo' };

    // act
    const result = pushSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });

  it('should reject when event uses an unknown namespace', () => {
    // arrange
    const msg = { ...fx.push(), event: 'bogus:event' };

    // act
    const result = pushSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('notifySchema.method', () => {
  it('should accept the canonical notify sample', () => {
    // arrange
    const msg = fx.notify();

    // act
    const result = notifySchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });

  it('should accept plugin-defined methods because notify is loose (RFC-007)', () => {
    // arrange — regression guard for the loose method semantics
    const msg = { ...fx.notify(), method: 'exports:custom.fn' };

    // act
    const result = notifySchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });
});

describe('pingSchema.envelope', () => {
  it('should accept a happy ping with numeric timestamp', () => {
    // arrange
    const msg = fx.ping();

    // act
    const result = pingSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });

  it('should reject when timestamp is a string', () => {
    // arrange
    const msg = { ...fx.ping(), timestamp: '1700000000' as unknown as number };

    // act
    const result = pingSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('pongSchema.envelope', () => {
  it('should accept a happy pong', () => {
    // arrange
    const msg = fx.pong();

    // act
    const result = pongSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(true);
  });

  it('should reject when pluginId is empty', () => {
    // arrange
    const msg = { ...fx.pong(), pluginId: '' };

    // act
    const result = pongSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('anyMessageSchema vs strictAnyMessageSchema', () => {
  const samples = [
    fx.handshake(),
    fx.handshakeAck(),
    fx.handshakeReject(),
    fx.request(),
    fx.successResponse(),
    fx.errorResponse(),
    fx.push(),
    fx.notify(),
    fx.ping(),
    fx.pong(),
  ];

  it.each(samples.map((s) => [s.type, s] as const))(
    'should accept happy %s sample under loose anyMessageSchema',
    (_type, msg) => {
      // act
      const result = anyMessageSchema.safeParse(msg);

      // assert
      expect(result.success).toBe(true);
    },
  );

  it.each(samples.map((s) => [s.type, s] as const))(
    'should accept happy %s sample under strictAnyMessageSchema',
    (_type, msg) => {
      // act
      const result = strictAnyMessageSchema.safeParse(msg);

      // assert
      expect(result.success).toBe(true);
    },
  );

  it('should reject a request with an extra __forge__ field under strictAnyMessageSchema', () => {
    // arrange
    const forged = { ...fx.request(), __forge__: true };

    // act
    const looseResult = anyMessageSchema.safeParse(forged);
    const strictResult = strictAnyMessageSchema.safeParse(forged);

    // assert
    expect(looseResult.success).toBe(true);
    expect(strictResult.success).toBe(false);
  });

  it('should reject a request whose method is plugin-defined under strictAnyMessageSchema (KNOWN_METHODS allowlist)', () => {
    // arrange
    const msg = { ...fx.request(), method: 'someCustom:method' };

    // act
    const result = strictAnyMessageSchema.safeParse(msg);

    // assert
    expect(result.success).toBe(false);
  });
});

describe('PROTOCOL_VERSION constant', () => {
  it('should equal 1 (RFC-001)', () => {
    // act / assert
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('should expose KNOWN_METHODS as a non-empty tuple', () => {
    // act / assert
    expect(KNOWN_METHODS.length).toBeGreaterThan(0);
    expect(new Set(KNOWN_METHODS).size).toBe(KNOWN_METHODS.length);
  });

  it('should expose EVENT_NAMESPACES with the 5 RFC-001 namespaces', () => {
    // act / assert
    expect([...EVENT_NAMESPACES].sort()).toEqual(
      ['auth', 'event', 'nui', 'plugin', 'ws'].sort(),
    );
  });
});
