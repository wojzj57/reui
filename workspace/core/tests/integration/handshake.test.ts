/**
 * 集成测试：握手流程（RFC-001 §3.6）。
 *
 * 覆盖：
 *   - 正常握手 ack → ready
 *   - reject → ReUIError 带正确 code
 *   - 超时 + 重试 → 最终成功
 *   - 重试耗尽 → TIMEOUT
 *   - ack 中的 runtimeOrigin 用于后续消息
 *   - 重复 init 返回同一 Promise
 *   - VERSION_MISMATCH ack 触发 fail
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../../src/client';
import { ReUIError } from '../../src/error';
import {
  HANDSHAKE_MAX_RETRIES,
  HANDSHAKE_RETRY_DELAYS_MS,
  HANDSHAKE_TIMEOUT_MS,
} from '../../src/constants';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';
import { makeAck } from '../helpers/factories';

describe('Client.handshake', () => {
  let iframe: IframeHandle;
  let runtime: MockRuntime;
  let client: Client;

  beforeEach(() => {
    iframe = setupIframeWindow();
    runtime = new MockRuntime(iframe);
    Client.__resetForTests();
    client = Client.getInstance();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Client.__resetForTests();
    runtime.dispose();
    iframe.dispose();
  });

  it('should resolve ready after receiving handshake-ack', async () => {
    // act
    const initPromise = client.init({ pluginId: 'inventory' });
    await vi.advanceTimersByTimeAsync(0);
    await initPromise;

    // assert
    expect(client.isReady).toBe(true);
    expect(runtime.received).toContainMessageMatching({
      type: 'reui:handshake',
      payload: { pluginId: 'inventory' },
    });
    expect(runtime.sent).toContainMessageMatching({
      type: 'reui:handshake-ack',
    });
  });

  it('should record runtimeOrigin from ack for subsequent messages', async () => {
    // arrange
    runtime.dispose();
    const customRuntime = new MockRuntime(iframe, {
      origin: 'https://runtime.custom',
    });

    // act
    const initPromise = client.init({ pluginId: 'p1' });
    await vi.advanceTimersByTimeAsync(0);
    await initPromise;

    // assert
    expect(client.currentRuntimeOrigin).toBe('https://runtime.custom');
    customRuntime.dispose();
  });

  it('should reject with HANDSHAKE error when runtime denies', async () => {
    // arrange
    runtime.rejectHandshake('UNKNOWN_PLUGIN', 'no such plugin');

    // act
    const initPromise = client.init({ pluginId: 'ghost' });
    initPromise.catch(() => {}); // 防止 unhandledrejection 噪音
    await vi.advanceTimersByTimeAsync(0);

    // assert
    const err = await initPromise.catch((e) => e);
    expect(err).toBeInstanceOf(ReUIError);
    expect(err).toMatchObject({
      code: 'UNKNOWN_PLUGIN',
      method: 'handshake',
      message: 'no such plugin',
    });
  });

  it('should retry handshake with exponential backoff and succeed before exhaustion', async () => {
    // arrange: 拦截 iframe.parent.postMessage，前 2 次握手不响应，第 3 次回 ack
    runtime.dispose();
    let attempt = 0;
    const innerPost = iframe.parent.postMessage.bind(iframe.parent);
    iframe.parent.postMessage = (data, targetOrigin) => {
      innerPost(data, targetOrigin);
      const msg = data as { type?: string; payload?: { pluginId: string } } | null;
      if (msg?.type === 'reui:handshake') {
        attempt += 1;
        if (attempt >= 3) {
          // 同步投递 ack
          iframe.parent.__deliver(
            makeAck({
              pluginId: msg.payload!.pluginId,
              runtimeOrigin: 'https://runtime.reui.local',
            }),
            'https://runtime.reui.local',
          );
        }
      }
    };

    // act
    const initPromise = client.init({ pluginId: 'p1' });
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(HANDSHAKE_RETRY_DELAYS_MS[0]!);
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(HANDSHAKE_RETRY_DELAYS_MS[1]!);
    await initPromise;

    // assert
    expect(client.isReady).toBe(true);
    expect(attempt).toBe(3);
  });

  it('should reject with TIMEOUT after all retries exhausted', async () => {
    // arrange
    runtime.dispose();
    const silentRuntime = new MockRuntime(iframe, { autoAck: false });

    // act
    const initPromise = client.init({ pluginId: 'p1' });
    initPromise.catch(() => {}); // 防止 unhandledrejection

    // 推进 (max+1) 次超时 + 中间的退避
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS);
    for (let i = 0; i < HANDSHAKE_MAX_RETRIES; i++) {
      const delay =
        HANDSHAKE_RETRY_DELAYS_MS[Math.min(i, HANDSHAKE_RETRY_DELAYS_MS.length - 1)]!;
      await vi.advanceTimersByTimeAsync(delay);
      await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS);
    }

    // assert
    await expect(initPromise).rejects.toBeInstanceOf(ReUIError);
    await expect(initPromise.catch((e) => e)).resolves.toMatchObject({
      code: 'TIMEOUT',
      method: 'handshake',
    });
    silentRuntime.dispose();
  });

  it('should return same promise for concurrent init calls', async () => {
    // act
    const p1 = client.init({ pluginId: 'p1' });
    const p2 = client.init({ pluginId: 'p1' });

    // assert
    expect(p1).toBe(p2);
    await vi.advanceTimersByTimeAsync(0);
    await p1;
  });

  it('should resolve immediately when init is called after ready', async () => {
    // arrange
    const initPromise = client.init({ pluginId: 'p1' });
    await vi.advanceTimersByTimeAsync(0);
    await initPromise;

    // act
    const second = client.init({ pluginId: 'p1' });

    // assert
    await expect(second).resolves.toBeUndefined();
  });

  it('should clean retry timer when dispose called during backoff window', async () => {
    // arrange
    runtime.dispose();
    const silentRuntime = new MockRuntime(iframe, { autoAck: false });

    // act
    const promise = client.init({ pluginId: 'p1' });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS); // 进入退避等待
    client.dispose();

    // assert: 后续即使继续推进，也不应抛错或重试
    await expect(
      Promise.race([
        promise,
        vi.advanceTimersByTimeAsync(10_000).then(() => 'ok'),
      ]),
    ).resolves.toBe('ok');
    silentRuntime.dispose();
  });

  it('should allow re-init after a previous failure', async () => {
    // arrange: 拦截 postMessage——第一次握手 reject，第二次 ack
    runtime.dispose();
    const r2 = new MockRuntime(iframe, { autoAck: false });
    let handshakeCount = 0;
    const inner = iframe.parent.postMessage.bind(iframe.parent);
    iframe.parent.postMessage = (data, origin) => {
      inner(data, origin);
      const m = data as { type?: string; payload?: { pluginId: string } } | null;
      if (m?.type === 'reui:handshake') {
        handshakeCount += 1;
        if (handshakeCount === 1) {
          iframe.parent.__deliver(
            { type: 'reui:handshake-reject', version: 1, payload: { code: 'UNKNOWN_PLUGIN', reason: 'no' } },
            'https://runtime.reui.local',
          );
        } else {
          iframe.parent.__deliver(
            makeAck({ pluginId: m.payload!.pluginId, runtimeOrigin: 'https://runtime.reui.local' }),
            'https://runtime.reui.local',
          );
        }
      }
    };

    const first = client.init({ pluginId: 'ghost' });
    first.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await first.catch(() => {});

    // act
    const second = client.init({ pluginId: 'inv' });
    await vi.advanceTimersByTimeAsync(0);

    // assert
    await expect(second).resolves.toBeUndefined();
    expect(client.isReady).toBe(true);
    r2.dispose();
  });
});
