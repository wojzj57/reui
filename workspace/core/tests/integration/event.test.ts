/**
 * 集成测试：event SDK 模块（RFC-003 §4.1）。
 *
 * 覆盖：on/once 订阅补全 `event:` 前缀、emit 透传 payload、push 投递、once 自动解绑。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../../src/client';
import { event } from '../../src/event';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('event module', () => {
  let iframe: IframeHandle;
  let runtime: MockRuntime;
  let client: Client;

  beforeEach(async () => {
    iframe = setupIframeWindow();
    runtime = new MockRuntime(iframe);
    runtime.on('event:subscribe', () => null);
    runtime.on('event:unsubscribe', () => null);
    runtime.on('event:emit', () => ({ ok: true }));
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

  it('should subscribe with event: prefix when on is called', async () => {
    // act
    event.on('player:died', () => {});
    await vi.advanceTimersByTimeAsync(0);

    // assert
    const sub = runtime.received.find(
      (m) =>
        m.type === 'reui:request' &&
        (m as { method: string }).method === 'event:subscribe',
    );
    expect(sub).toMatchObject({ params: { event: 'event:player:died' } });
  });

  it('should deliver push payload to on handler', async () => {
    // arrange
    const h = vi.fn();
    event.on('player:died', h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('event:player:died', { id: 7 });

    // assert
    expect(h).toHaveBeenCalledWith({ id: 7 });
  });

  it('should emit with prefixed event name and payload', async () => {
    // act
    await event.emit('score:update', { n: 3 });

    // assert
    const emit = runtime.received.find(
      (m) =>
        m.type === 'reui:request' &&
        (m as { method: string }).method === 'event:emit',
    );
    expect(emit).toMatchObject({
      params: { event: 'event:score:update', payload: { n: 3 } },
    });
  });

  it('should fire once handler a single time then unsubscribe', async () => {
    // arrange
    const h = vi.fn();
    event.once('ping', h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('event:ping', 1);
    runtime.push('event:ping', 2);
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith(1);
    expect(client.subscriptionSize).toBe(0);
  });
});
