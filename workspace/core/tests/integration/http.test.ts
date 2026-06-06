/**
 * 集成测试：http SDK 模块（RFC-003 §4.2）。
 *
 * 覆盖：各 verb 透传 method/url/data、返回响应体 data、config 透传。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestMessage } from '@reui/interface';
import { Client } from '../../src/client';
import { http } from '../../src/http';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('http module', () => {
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

  it('should send GET with method and url and return response data', async () => {
    // arrange
    runtime.on('http:request', () => ({
      status: 200,
      data: { players: 3 },
      headers: {},
    }));

    // act
    const data = await http.get<{ players: number }>('/api/players');

    // assert
    expect(data).toEqual({ players: 3 });
    const req = runtime.received.find(
      (m) =>
        m.type === 'reui:request' &&
        (m as { method: string }).method === 'http:request',
    ) as RequestMessage;
    expect(req.params).toMatchObject({ method: 'GET', url: '/api/players' });
  });

  it('should forward body data and config on post', async () => {
    // arrange
    runtime.on('http:request', (msg) => ({
      status: 201,
      data: (msg.params as { data: unknown }).data,
      headers: {},
    }));

    // act
    const data = await http.post('/api/login', { user: 'a' }, { timeout: 5000 });

    // assert
    expect(data).toEqual({ user: 'a' });
    const req = runtime.received.find(
      (m) =>
        m.type === 'reui:request' &&
        (m as { method: string }).method === 'http:request',
    ) as RequestMessage;
    expect(req.params).toMatchObject({
      method: 'POST',
      url: '/api/login',
      data: { user: 'a' },
      timeout: 5000,
    });
  });

  it('should map put/delete/patch verbs onto http:request', async () => {
    // arrange
    runtime.on('http:request', (msg) => ({
      status: 200,
      data: (msg.params as { method: string }).method,
      headers: {},
    }));

    // act
    const put = await http.put('/a', { x: 1 });
    const del = await http.delete('/a');
    const patch = await http.patch('/a', { y: 2 });

    // assert
    expect([put, del, patch]).toEqual(['PUT', 'DELETE', 'PATCH']);
  });

  it('should reject with ReUIError when runtime returns NETWORK_ERROR', async () => {
    // arrange
    runtime.fail('http:request', { code: 'NETWORK_ERROR', message: 'boom' });

    // act / assert
    await expect(http.get('/api/x')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});
