/**
 * 集成测试：消息源验证与异常容忍（RFC-001 §3.5、§5.1）。
 *
 * 覆盖：
 *   - 非 window.parent 来源的消息被忽略
 *   - 非 reui: 前缀消息被忽略
 *   - 未知 reui:* 类型被忽略（前向兼容）
 *   - 非对象 data 被忽略
 *   - VERSION_MISMATCH 的 ack 触发握手失败
 *   - dispose 后仍 reject pending 请求
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../../src/client';
import { ReUIError } from '../../src/error';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('Client message validation', () => {
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

  it('should ignore messages whose source is not window.parent', () => {
    // arrange
    const handler = vi.fn();
    client.onPush('event:foo', handler);

    // act: 派发一个 source 为 window 自身的事件，模拟来自游戏的消息
    const ev = new MessageEvent('message', {
      data: { type: 'reui:push', version: 1, event: 'event:foo', payload: 1 },
      source: window,
    });
    window.dispatchEvent(ev);

    // assert
    expect(handler).not.toHaveBeenCalled();
  });

  it('should ignore non-reui prefixed messages', () => {
    // arrange
    const handler = vi.fn();
    client.onPush('event:foo', handler);

    // act: 自定义投递不带 reui: 前缀
    iframe.parent.__deliver({ type: 'other:foo', payload: 1 }, 'https://runtime.reui.local');

    // assert
    expect(handler).not.toHaveBeenCalled();
  });

  it('should ignore unknown reui:* types without throwing (forward compat)', () => {
    // act
    expect(() => {
      iframe.parent.__deliver({ type: 'reui:future-type', version: 1 }, 'https://runtime.reui.local');
    }).not.toThrow();
  });

  it('should ignore non-object message data', () => {
    // act
    expect(() => {
      iframe.parent.__deliver(null, 'https://runtime.reui.local');
      iframe.parent.__deliver('a string', 'https://runtime.reui.local');
      iframe.parent.__deliver(42, 'https://runtime.reui.local');
    }).not.toThrow();
  });

  it('should fail handshake when ack carries unsupported version', async () => {
    // arrange
    Client.__resetForTests();
    runtime.dispose();
    runtime = new MockRuntime(iframe, { autoAck: false });
    client = Client.getInstance();

    // 自己驱动一个 version 错误的 ack
    const initPromise = client.init({ pluginId: 'inv' });
    initPromise.catch(() => {});
    iframe.parent.__deliver(
      {
        type: 'reui:handshake-ack',
        version: 99,
        payload: {
          sessionId: 's',
          pluginId: 'inv',
          runtimeOrigin: 'https://runtime.reui.local',
          permissions: [],
          config: { layer: 'panel', allowedEvents: [] },
        },
      },
      'https://runtime.reui.local',
    );

    // act / assert
    const err = await initPromise.catch((e) => e);
    expect(err).toBeInstanceOf(ReUIError);
    expect(err).toMatchObject({ code: 'VERSION_MISMATCH', method: 'handshake' });
  });

  it('should reject pending requests on dispose with RUNTIME_ERROR', async () => {
    // arrange
    runtime.on('hang', () => new Promise(() => {}));
    const promise = client.request('hang').catch((e) => e);
    await vi.advanceTimersByTimeAsync(0); // 让 ensureReady 的 await 完成、pending 注册

    // act
    client.dispose();

    // assert
    const err = await promise;
    expect(err).toMatchObject({ code: 'RUNTIME_ERROR', method: 'hang' });
    expect(client.pendingSize).toBe(0);
    expect(client.subscriptionSize).toBe(0);
  });

  it('should drop spurious response for unknown id', async () => {
    // act / assert
    expect(() => {
      iframe.parent.__deliver(
        {
          type: 'reui:response',
          version: 1,
          id: 'no-such-id',
          success: true,
          result: 'who?',
        },
        'https://runtime.reui.local',
      );
    }).not.toThrow();
  });
});
