/**
 * 集成测试：nui SDK 模块（RFC-003 §4.5）。
 *
 * 覆盖：onGameEvent 收取 nui:${event} push、sendToGame 透传 event/data 并返回响应。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestMessage } from '@reui/interface';
import { Client } from '../../src/client';
import { nui } from '../../src/nui';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('nui module', () => {
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

  it('should receive game events via onGameEvent', async () => {
    // arrange
    const h = vi.fn();
    nui.onGameEvent('openMenu', h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('nui:openMenu', { slot: 2 });

    // assert
    expect(h).toHaveBeenCalledWith({ slot: 2 });
  });

  it('should send event and data to game and return response', async () => {
    // arrange
    runtime.on('nui:send', (msg) => ({
      echoed: (msg.params as { data: unknown }).data,
    }));

    // act
    const res = await nui.sendToGame('buyItem', { id: 9 });

    // assert
    expect(res).toEqual({ echoed: { id: 9 } });
    const req = runtime.received.find(
      (m) =>
        m.type === 'reui:request' &&
        (m as { method: string }).method === 'nui:send',
    ) as RequestMessage;
    expect(req.params).toEqual({ event: 'buyItem', data: { id: 9 } });
  });
});
