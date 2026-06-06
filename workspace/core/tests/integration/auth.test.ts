/**
 * 集成测试：auth SDK 模块（RFC-003 §4.4）。
 *
 * 覆盖：getUser/hasPermission/checkPermissions/getRoles 请求与返回、
 * onUserChange/onPermissionChange push 投递。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestMessage } from '@reui/interface';
import { Client } from '../../src/client';
import { auth } from '../../src/auth';
import { setupIframeWindow, type IframeHandle } from '../helpers/iframe-window';
import { MockRuntime } from '../helpers/mock-runtime';

describe('auth module', () => {
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

  it('should return current user', async () => {
    // arrange
    runtime.on('auth:getUser', () => ({
      id: '1',
      name: 'Alice',
      identifiers: ['steam:x'],
    }));

    // act
    const user = await auth.getUser();

    // assert
    expect(user).toMatchObject({ id: '1', name: 'Alice' });
  });

  it('should pass permission to hasPermission', async () => {
    // arrange
    runtime.on('auth:hasPermission', () => true);

    // act
    const ok = await auth.hasPermission('shop.buy');

    // assert
    expect(ok).toBe(true);
    const req = runtime.received.find(
      (m) =>
        m.type === 'reui:request' &&
        (m as { method: string }).method === 'auth:hasPermission',
    ) as RequestMessage;
    expect(req.params).toEqual({ permission: 'shop.buy' });
  });

  it('should pass permission list to checkPermissions', async () => {
    // arrange
    runtime.on('auth:checkPermissions', () => false);

    // act
    const all = await auth.checkPermissions(['a', 'b']);

    // assert
    expect(all).toBe(false);
    const req = runtime.received.find(
      (m) =>
        m.type === 'reui:request' &&
        (m as { method: string }).method === 'auth:checkPermissions',
    ) as RequestMessage;
    expect(req.params).toEqual({ permissions: ['a', 'b'] });
  });

  it('should return roles from getRoles', async () => {
    // arrange
    runtime.on('auth:getRoles', () => ['admin', 'vip']);

    // act / assert
    expect(await auth.getRoles()).toEqual(['admin', 'vip']);
  });

  it('should deliver user changes via onUserChange', async () => {
    // arrange
    const h = vi.fn();
    auth.onUserChange(h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('auth:userChanged', { id: '2', name: 'Bob', identifiers: [] });

    // assert
    expect(h).toHaveBeenCalledWith({ id: '2', name: 'Bob', identifiers: [] });
  });

  it('should deliver permission changes via onPermissionChange', async () => {
    // arrange
    const h = vi.fn();
    auth.onPermissionChange(h);
    await vi.advanceTimersByTimeAsync(0);

    // act
    runtime.push('auth:permissionsChanged', ['shop.buy']);

    // assert
    expect(h).toHaveBeenCalledWith(['shop.buy']);
  });
});
