/**
 * 集成测试：push / subscribe / unsubscribe（RFC-001 §3.5、附录 C）。
 *
 * 覆盖：
 *   - 首次订阅自动发送 event:subscribe
 *   - 第二个 handler 不重复发送 subscribe
 *   - 最后一个 handler 移除发送 event:unsubscribe
 *   - push 路由到全部已注册 handler
 *   - 一个 handler 抛错不影响其它 handler
 *   - 没有订阅者时收到 push 不报错
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../../src/client';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('Client.onPush', () => {
  let iframe: IframeHandle;
  let runtime: MockRuntime;
  let client: Client;

  beforeEach(async () => {
    iframe = setupIframeWindow();
    runtime = new MockRuntime(iframe);
    runtime.on('event:subscribe', () => null);
    runtime.on('event:unsubscribe', () => null);
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

  it('should send event:subscribe exactly once on first subscription', async () => {
    // act
    client.onPush('event:foo', () => {});
    client.onPush('event:foo', () => {});
    await vi.advanceTimersByTimeAsync(0);

    // assert
    const subs = runtime.received.filter(
      (m) => m.type === 'reui:request' && (m as { method: string }).method === 'event:subscribe',
    );
    expect(subs).toHaveLength(1);
  });

  it('should deliver push payload to all registered handlers', async () => {
    // arrange
    const h1 = vi.fn();
    const h2 = vi.fn();
    client.onPush('event:foo', h1);
    client.onPush('event:foo', h2);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('event:foo', { x: 1 });

    // assert
    expect(h1).toHaveBeenCalledWith({ x: 1 });
    expect(h2).toHaveBeenCalledWith({ x: 1 });
  });

  it('should send event:unsubscribe when last handler removed', async () => {
    // arrange
    const h1 = vi.fn();
    const h2 = vi.fn();
    const off1 = client.onPush('event:foo', h1);
    const off2 = client.onPush('event:foo', h2);
    await vi.advanceTimersByTimeAsync(0);

    // act
    off1();
    await vi.advanceTimersByTimeAsync(0);
    let unsub = runtime.received.filter(
      (m) => m.type === 'reui:request' && (m as { method: string }).method === 'event:unsubscribe',
    );
    expect(unsub).toHaveLength(0); // 还有 h2，不应触发

    off2();
    await vi.advanceTimersByTimeAsync(0);
    unsub = runtime.received.filter(
      (m) => m.type === 'reui:request' && (m as { method: string }).method === 'event:unsubscribe',
    );

    // assert
    expect(unsub).toHaveLength(1);
    expect(client.subscriptionSize).toBe(0);
  });

  it('should be idempotent on double-unsubscribe', async () => {
    // arrange
    const h = vi.fn();
    const off = client.onPush('event:foo', h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    off();
    off();
    await vi.advanceTimersByTimeAsync(0);

    // assert
    const unsubs = runtime.received.filter(
      (m) => m.type === 'reui:request' && (m as { method: string }).method === 'event:unsubscribe',
    );
    expect(unsubs).toHaveLength(1);
  });

  it('should isolate handler errors so siblings still fire', async () => {
    // arrange
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    client.onPush('event:foo', bad);
    client.onPush('event:foo', good);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('event:foo', null);

    // assert
    expect(bad).toHaveBeenCalledOnce();
    expect(good).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should silently drop push when no subscribers', () => {
    // act / assert
    expect(() => runtime.push('event:nobody', null)).not.toThrow();
  });

  it('should roll back local handler when event:subscribe fails', async () => {
    // arrange: 重新装配，让 event:subscribe 返回错误
    Client.__resetForTests();
    runtime.dispose();
    runtime = new MockRuntime(iframe);
    runtime.fail('event:subscribe', { code: 'EVENT_DENIED', message: 'denied' });
    client = Client.getInstance();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const initPromise = client.init({ pluginId: 'inv' });
    await vi.advanceTimersByTimeAsync(0);
    await initPromise;

    // act
    const handler = vi.fn();
    client.onPush('event:rejected', handler);
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(consoleSpy).toHaveBeenCalled();
    // handler 应被回滚，subscriptionSize 回到 0
    expect(client.subscriptionSize).toBe(0);
    consoleSpy.mockRestore();
  });

  it('should log a warning when event:unsubscribe fails', async () => {
    // arrange
    Client.__resetForTests();
    runtime.dispose();
    runtime = new MockRuntime(iframe);
    runtime.on('event:subscribe', () => null);
    runtime.fail('event:unsubscribe', { code: 'RUNTIME_ERROR', message: 'oops' });
    client = Client.getInstance();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const initPromise = client.init({ pluginId: 'inv' });
    await vi.advanceTimersByTimeAsync(0);
    await initPromise;

    const off = client.onPush('event:foo', () => {});
    await vi.advanceTimersByTimeAsync(0);

    // act
    off();
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
