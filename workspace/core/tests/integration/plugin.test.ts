/**
 * 集成测试：plugin SDK 模块（RFC-003 §4.6）。
 *
 * 覆盖：getConfig/show/hide、saveState 包 {payload}、restoreState 解包、
 * onVisibilityChange 按自身 pluginId 过滤。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestMessage } from '@reui/interface';
import { Client } from '../../src/client';
import { plugin } from '../../src/plugin';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('plugin module', () => {
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

  it('should return manifest config from getConfig', async () => {
    // arrange
    runtime.on('plugin:getConfig', () => ({ id: 'inv', layer: 'panel' }));

    // act
    const config = await plugin.getConfig();

    // assert
    expect(config).toMatchObject({ id: 'inv', layer: 'panel' });
  });

  it('should issue plugin:show and plugin:hide on requestShow/requestHide', async () => {
    // arrange
    runtime.on('plugin:show', () => ({ ok: true }));
    runtime.on('plugin:hide', () => ({ ok: true }));

    // act
    await plugin.requestShow();
    await plugin.requestHide();

    // assert
    const methods = runtime.received
      .filter((m) => m.type === 'reui:request')
      .map((m) => (m as { method: string }).method);
    expect(methods).toContain('plugin:show');
    expect(methods).toContain('plugin:hide');
  });

  it('should default onBeforeUnload reason to empty string when absent', async () => {
    // arrange
    const h = vi.fn();
    plugin.onBeforeUnload(h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('plugin:beforeUnload', {});

    // assert
    expect(h).toHaveBeenCalledWith('');
  });

  it('should wrap state in payload on saveState and unwrap on restoreState', async () => {
    // arrange
    let stored: unknown;
    runtime.on('plugin:saveState', (msg) => {
      stored = (msg.params as { payload: unknown }).payload;
      return { ok: true };
    });
    runtime.on('plugin:restoreState', () => ({ payload: stored }));

    // act
    await plugin.saveState({ count: 5 });
    const restored = await plugin.restoreState<{ count: number }>();

    // assert
    const save = runtime.received.find(
      (m) =>
        m.type === 'reui:request' &&
        (m as { method: string }).method === 'plugin:saveState',
    ) as RequestMessage;
    expect(save.params).toEqual({ payload: { count: 5 } });
    expect(restored).toEqual({ count: 5 });
  });

  it('should return null from restoreState when no state', async () => {
    // arrange
    runtime.on('plugin:restoreState', () => ({ payload: null }));

    // act / assert
    expect(await plugin.restoreState()).toBeNull();
  });

  it('should fire onVisibilityChange only for own pluginId', async () => {
    // arrange
    const h = vi.fn();
    plugin.onVisibilityChange(h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('plugin:visibility', { pluginId: 'other', visible: true });
    runtime.push('plugin:visibility', { pluginId: 'inv', visible: false });

    // assert
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith(false);
  });

  it('should deliver reason to onBeforeUnload', async () => {
    // arrange
    const h = vi.fn();
    plugin.onBeforeUnload(h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('plugin:beforeUnload', { reason: 'hot-reload' });

    // assert
    expect(h).toHaveBeenCalledWith('hot-reload');
  });
});
