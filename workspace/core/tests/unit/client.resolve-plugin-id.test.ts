/**
 * 单元测试：pluginId 解析（RFC-001 §3.5）。
 *
 * 解析顺序：
 *   1. options.pluginId（显式优先）
 *   2. URL ?__reui_id= 查询参数
 *   3. 否则抛错
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../../src/client';
import { ReUIError } from '../../src/error';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('Client.resolvePluginId', () => {
  let iframe: IframeHandle;
  let runtime: MockRuntime;

  beforeEach(() => {
    iframe = setupIframeWindow();
    runtime = new MockRuntime(iframe);
    Client.__resetForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Client.__resetForTests();
    runtime.dispose();
    iframe.dispose();
    // 还原 URL，避免影响其它用例。
    window.history.replaceState(null, '', '/');
  });

  it('should prefer options.pluginId over URL parameter', async () => {
    // arrange
    window.history.replaceState(null, '', '/?__reui_id=from-url');
    const client = Client.getInstance();

    // act
    const initPromise = client.init({ pluginId: 'from-options' });
    await vi.advanceTimersByTimeAsync(0);
    await initPromise;

    // assert: 握手消息使用 options 的 pluginId
    expect(runtime.received).toContainMessageMatching({
      type: 'reui:handshake',
      payload: { pluginId: 'from-options' },
    });
  });

  it('should fall back to URL ?__reui_id= when options omitted', async () => {
    // arrange
    window.history.replaceState(null, '', '/?__reui_id=inventory');
    const client = Client.getInstance();

    // act
    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(0);
    await initPromise;

    // assert
    expect(runtime.received).toContainMessageMatching({
      type: 'reui:handshake',
      payload: { pluginId: 'inventory' },
    });
  });

  it('should reject with INVALID_PARAMS when no pluginId can be resolved', async () => {
    // arrange
    window.history.replaceState(null, '', '/'); // 无查询参数
    const client = Client.getInstance();

    // act / assert
    await expect(client.init()).rejects.toBeInstanceOf(ReUIError);
    await expect(client.init()).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      method: 'init',
    });
  });
});
