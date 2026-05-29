/**
 * 集成测试：心跳（RFC-001 §3.7）。
 *
 * 覆盖：
 *   - 收到 ping 立即回 pong
 *   - pong 透传 ping 的 timestamp
 *   - pong 携带正确 pluginId
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../../src/client';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('Client heartbeat', () => {
  let iframe: IframeHandle;
  let runtime: MockRuntime;
  let client: Client;

  beforeEach(async () => {
    iframe = setupIframeWindow();
    runtime = new MockRuntime(iframe);
    Client.__resetForTests();
    client = Client.getInstance();
    vi.useFakeTimers();
    const initPromise = client.init({ pluginId: 'inv' });
    await vi.advanceTimersByTimeAsync(0);
    await initPromise;
  });

  afterEach(() => {
    vi.useRealTimers();
    Client.__resetForTests();
    runtime.dispose();
    iframe.dispose();
  });

  it('should reply with pong carrying the same timestamp', () => {
    // act
    runtime.ping(1234567890);

    // assert
    expect(runtime.received).toContainMessageMatching({
      type: 'reui:pong',
      pluginId: 'inv',
      timestamp: 1234567890,
    });
  });

  it('should respond to multiple pings independently', () => {
    // act
    runtime.ping(1);
    runtime.ping(2);
    runtime.ping(3);

    // assert
    const pongs = runtime.received.filter((m) => m.type === 'reui:pong');
    expect(pongs).toHaveLength(3);
    expect(pongs.map((p) => (p as { timestamp: number }).timestamp)).toEqual([1, 2, 3]);
  });
});
