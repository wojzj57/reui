import { describe, expectTypeOf, it } from 'vitest';
import type {
  EventNamespace,
  HandshakeMessage,
  KnownMethod,
  ProtocolVersion,
} from '../../src/protocol/messages';

describe('protocol type contracts', () => {
  it('should pin HandshakeMessage["version"] to literal 1', () => {
    expectTypeOf<HandshakeMessage['version']>().toEqualTypeOf<1>();
  });

  it('should not widen HandshakeMessage["version"] to number', () => {
    expectTypeOf<HandshakeMessage['version']>().not.toEqualTypeOf<number>();
  });

  it('should expose ProtocolVersion as the literal 1', () => {
    expectTypeOf<ProtocolVersion>().toEqualTypeOf<1>();
  });

  it('should pin KnownMethod to the full RFC-001 §4.1 union', () => {
    expectTypeOf<KnownMethod>().toEqualTypeOf<
      | 'event:subscribe'
      | 'event:unsubscribe'
      | 'event:emit'
      | 'http:request'
      | 'ws:send'
      | 'ws:state'
      | 'auth:getUser'
      | 'auth:hasPermission'
      | 'auth:checkPermissions'
      | 'nui:send'
      | 'plugin:getConfig'
      | 'plugin:show'
      | 'plugin:hide'
      | 'plugin:ready'
      | 'plugin:saveState'
      | 'plugin:restoreState'
    >();
  });

  it('should pin EventNamespace to the 5 RFC-001 §3.1 namespaces', () => {
    expectTypeOf<EventNamespace>().toEqualTypeOf<
      'event' | 'nui' | 'ws' | 'auth' | 'plugin'
    >();
  });
});
