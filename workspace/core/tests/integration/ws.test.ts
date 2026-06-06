/**
 * 集成测试：ws SDK 模块（RFC-003 §4.3）。
 *
 * 覆盖：send 透传 channel/data、getState 解包、subscribe 收取 ws:${channel}、
 * onStateChange 收取 ws:stateChanged。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestMessage } from '@reui/interface';
import { Client } from '../../src/client';
import { ws } from '../../src/ws';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('ws module', () => {
  let iframe: IframeHandle;
  let runtime: MockRuntime;
  let client: Client;

  beforeEach(async () => {
    iframe = setupIframeWindow();
    runtime = new MockRuntime(iframe);
    runtime.on('event:subscribe', () => null);
    runtime.on('event:unsubscribe', () => null);
    runtime.on('ws:send', () => ({ ok: true }));
    runtime.on('ws:state', () => ({ state: 'connected' }));
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

  it('should send channel and data', async () => {
    // act
    await ws.send('chat', { text: 'hi' });

    // assert
    const req = runtime.received.find(
      (m) =>
        m.type === 'reui:request' &&
        (m as { method: string }).method === 'ws:send',
    ) as RequestMessage;
    expect(req.params).toEqual({ channel: 'chat', data: { text: 'hi' } });
  });

  it('should unwrap state from ws:state response', async () => {
    // act
    const state = await ws.getState();

    // assert
    expect(state).toBe('connected');
  });

  it('should receive channel messages via subscribe', async () => {
    // arrange
    const h = vi.fn();
    ws.subscribe('chat', h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('ws:chat', { text: 'yo' });

    // assert
    expect(h).toHaveBeenCalledWith({ text: 'yo' });
  });

  it('should receive state changes via onStateChange', async () => {
    // arrange
    const h = vi.fn();
    ws.onStateChange(h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('ws:stateChanged', 'reconnecting');

    // assert
    expect(h).toHaveBeenCalledWith('reconnecting');
  });
});
