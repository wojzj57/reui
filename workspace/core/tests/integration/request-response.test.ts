/**
 * 集成测试：request / response（RFC-001 §3.5）。
 *
 * 覆盖：
 *   - 正常 request → response 往返
 *   - request id 形如 {pluginId}:{seq}
 *   - 多并发 request id 路由正确
 *   - 错误 response 转 ReUIError
 *   - 超时清理 pending（无内存泄漏）
 *   - response 携带 details
 *   - request 在 init 完成前调用会等待
 *   - notify 不期待响应
 *   - 未知 method → METHOD_NOT_FOUND
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../../src/client';
import { ReUIError } from '../../src/error';
import { REQUEST_TIMEOUT_MS } from '../../src/constants';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('Client.request', () => {
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

  it('should resolve with handler result on success', async () => {
    // arrange
    runtime.on('http:request', () => ({ status: 200, data: 'ok' }));

    // act
    const result = await client.request('http:request', { url: '/api' });

    // assert
    expect(result).toEqual({ status: 200, data: 'ok' });
  });

  it('should generate request id of form {pluginId}:{seq}', async () => {
    // arrange
    runtime.on('noop', () => null);

    // act
    await client.request('noop');
    await client.request('noop');

    // assert
    const reqs = runtime.received.filter((m) => m.type === 'reui:request');
    expect(reqs.length).toBeGreaterThanOrEqual(2);
    expect((reqs[0] as { id: string }).id).toBe('inv:1');
    expect((reqs[1] as { id: string }).id).toBe('inv:2');
  });

  it('should route concurrent responses by id', async () => {
    // arrange: 让 'slow' 延迟解析；'fast' 立即解析
    runtime.on('slow', async () => {
      await new Promise<void>((r) => setTimeout(r, 50));
      return 'slow-result';
    });
    runtime.on('fast', () => 'fast-result');

    // act
    const slowPromise = client.request<string>('slow');
    const fastPromise = client.request<string>('fast');
    await vi.advanceTimersByTimeAsync(50);

    // assert
    await expect(fastPromise).resolves.toBe('fast-result');
    await expect(slowPromise).resolves.toBe('slow-result');
  });

  it('should reject with ReUIError mapped from error response', async () => {
    // arrange
    runtime.fail('forbidden', { code: 'CAPABILITY_DENIED', message: 'no cap' });

    // act / assert
    const err = await client.request('forbidden').catch((e) => e);
    expect(err).toBeInstanceOf(ReUIError);
    expect(err).toMatchObject({
      code: 'CAPABILITY_DENIED',
      method: 'forbidden',
      message: 'no cap',
    });
  });

  it('should reject with METHOD_NOT_FOUND for unhandled methods', async () => {
    // act
    const err = await client.request('does:not:exist').catch((e) => e);

    // assert
    expect(err).toMatchObject({ code: 'METHOD_NOT_FOUND', method: 'does:not:exist' });
  });

  it('should clean up pending map after timeout', async () => {
    // arrange
    runtime.on('hang', () => new Promise(() => {})); // 永不响应

    // act
    const promise = client.request('hang').catch((e) => e);
    await vi.advanceTimersByTimeAsync(0); // 让 ensureReady 的 await 完成
    expect(client.pendingSize).toBe(1);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    // assert
    const err = await promise;
    expect(err).toMatchObject({ code: 'TIMEOUT', method: 'hang' });
    expect(client.pendingSize).toBe(0);
  });

  it('should respect custom requestTimeoutMs from init options', async () => {
    // arrange: 重置并以更短超时重新 init
    Client.__resetForTests();
    runtime.dispose();
    runtime = new MockRuntime(iframe);
    client = Client.getInstance();
    runtime.on('hang', () => new Promise(() => {}));

    const initPromise = client.init({ pluginId: 'inv', requestTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    await initPromise;

    // act
    const promise = client.request('hang').catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);

    // assert
    const err = await promise;
    expect(err).toMatchObject({ code: 'TIMEOUT' });
  });

  it('should send notify without expecting response', async () => {
    // act
    await client.notify('telemetry:event', { name: 'click' });

    // assert
    expect(runtime.received).toContainMessageMatching({
      type: 'reui:notify',
      method: 'telemetry:event',
      params: { name: 'click' },
    });
  });

  it('should reject when used before init', async () => {
    // arrange
    Client.__resetForTests();
    const fresh = Client.getInstance();

    // act / assert
    await expect(fresh.request('foo')).rejects.toMatchObject({
      code: 'NOT_READY',
      method: 'request',
    });
  });

  it('should pass error details through to ReUIError', async () => {
    // arrange
    runtime.on('q', (req) => {
      // 直接驱动一个带 details 的错误响应
      iframe.parent.__deliver(
        {
          type: 'reui:response',
          version: 1,
          id: req.id,
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'bad', details: { field: 'x' } },
        },
        'https://runtime.reui.local',
      );
      return new Promise(() => {}); // 我们已自行投递响应
    });

    // act
    const err = await client.request('q').catch((e) => e);

    // assert
    expect(err).toBeInstanceOf(ReUIError);
    expect((err as ReUIError).details).toEqual({ field: 'x' });
  });
});
