import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { anyMessageSchema, PROTOCOL_VERSION } from '@reui/interface';
import { MockRuntime } from '../helpers/mock-runtime';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { makeHandshake } from '../helpers/factories';

/**
 * Smoke contract test (plan §14 step 1–2).
 *
 * Confirms that:
 *  - @reui/interface exposes a discriminated-union schema covering every
 *    RFC-001 message type.
 *  - The MockRuntime / iframe-window / factories stack drives a complete
 *    handshake round-trip without any real Client implementation yet.
 *  - The custom `toContainMessageMatching` matcher is registered.
 *
 * When the real Client lands, this file will be replaced/augmented by
 * `tests/integration/handshake.test.ts` per plan §8.1.
 */
describe('@reui/core test scaffolding', () => {
  let iframe: IframeHandle;
  let runtime: MockRuntime;

  beforeEach(() => {
    iframe = setupIframeWindow();
    runtime = new MockRuntime(iframe);
  });

  afterEach(() => {
    runtime.dispose();
    iframe.dispose();
  });

  it('should validate every RFC-001 message via the shared Zod schema', () => {
    // arrange
    const handshake = makeHandshake({ pluginId: 'inventory' });

    // act
    const parsed = anyMessageSchema.parse(handshake);

    // assert
    expect(parsed.type).toBe('reui:handshake');
    expect(parsed.version).toBe(PROTOCOL_VERSION);
  });

  it('should auto-ack a handshake delivered through MockRuntime', () => {
    // arrange
    const handshake = makeHandshake({ pluginId: 'inventory' });

    // act
    iframe.parent.postMessage(handshake, '*');

    // assert
    expect(runtime.received).toContainMessageMatching({
      type: 'reui:handshake',
      payload: { pluginId: 'inventory' },
    });
    expect(runtime.sent).toContainMessageMatching({
      type: 'reui:handshake-ack',
      payload: { pluginId: 'inventory' },
    });
  });
});
