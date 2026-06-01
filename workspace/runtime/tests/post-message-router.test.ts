/**
 * 单元测试：PostMessageRouter（Stage A1）。
 *
 * 覆盖：
 *   - handshake / request / notify / pong 四类入站消息；
 *   - method 注册表 + capability 校验；
 *   - VERSION_MISMATCH / UNKNOWN_PLUGIN / METHOD_NOT_FOUND /
 *     CAPABILITY_DENIED / INVALID_PARAMS / RUNTIME_ERROR 几类错误；
 *   - 订阅 / 取订阅 / plugin:unloaded 自动清理；
 *   - 内置 method 抽样：auth:* / nui:send / plugin:show。
 *
 * 关键约束：
 *   - jsdom + fake timers（toFake: Date / setInterval / clearInterval）；
 *   - 严禁真实 setTimeout、严禁 `as any`；
 *   - 用 iframeFactory 注入 stub iframe，从插件 postMessage 拿到回包断言；
 *   - response / handshake-ack 字段断言用"子集 +关键字段"，不做整对象 toEqual。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@reui/interface';
import { AuthService } from '../src/auth-service';
import { EventBus } from '../src/event-bus';
import { HeartbeatMonitor } from '../src/heartbeat-monitor';
import { LayerSystem } from '../src/layer-system';
import { NuiBridge } from '../src/nui-bridge';
import {
  PluginManager,
  PluginManagerError,
  type PluginInstance,
  type PluginManifestMinimal,
} from '../src/plugin-manager';
import { PostMessageRouter } from '../src/post-message-router';

// ── 测试夹具 ─────────────────────────────────────────────────────────────

interface WindowProxyStub {
  postMessage: ReturnType<typeof vi.fn>;
}

interface CapturedMessage {
  type: string;
  [key: string]: unknown;
}

const isCapturedMessage = (v: unknown): v is CapturedMessage =>
  typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';

const makeStubIframe = (): {
  iframe: HTMLIFrameElement;
  fakeWindow: WindowProxyStub;
} => {
  const iframe = document.createElement('iframe');
  const fakeWindow: WindowProxyStub = { postMessage: vi.fn() };
  Object.defineProperty(iframe, 'contentWindow', {
    value: fakeWindow,
    configurable: true,
  });
  return { iframe, fakeWindow };
};

const iframeQueue: HTMLIFrameElement[] = [];

const installStubManager = (): PluginManager =>
  PluginManager.getInstance({
    iframeFactory: () => {
      const next = iframeQueue.shift();
      if (!next) throw new Error('test setup: iframe queue exhausted');
      return next;
    },
  });

interface LoadedPlugin {
  plugin: PluginInstance;
  fakeWindow: WindowProxyStub;
  /** 取插件被发送过来的所有消息（按时间序）。 */
  outbox: () => CapturedMessage[];
  /** 取最后一条入栈消息；为空抛错。 */
  lastMessage: () => CapturedMessage;
}

const loadPlugin = async (
  overrides: Partial<PluginManifestMinimal> = {},
): Promise<LoadedPlugin> => {
  const stub = makeStubIframe();
  iframeQueue.push(stub.iframe);
  // 必须先用 stub iframeFactory 拉起 PluginManager 单例。`beforeEach` 已经
  // 调过 `installStubManager()`，确保单例在 router/getInstance 之前就绑定了
  // stub iframeFactory；这里只是把下一份 stub iframe 排队到 queue 里。
  const manager = PluginManager.getInstance();
  const manifest: PluginManifestMinimal = {
    id: overrides.id ?? 'plugin-a',
    entry: overrides.entry ?? 'https://plugin.example/index.html',
    layer: overrides.layer ?? 'hud',
    ...(overrides.permissions !== undefined
      ? { permissions: overrides.permissions }
      : {}),
  };
  const plugin = await manager.loadPlugin(manifest);
  const outbox = (): CapturedMessage[] => {
    const calls = stub.fakeWindow.postMessage.mock.calls;
    const out: CapturedMessage[] = [];
    for (const call of calls) {
      const data = call[0] as unknown;
      if (isCapturedMessage(data)) out.push(data);
    }
    return out;
  };
  const lastMessage = (): CapturedMessage => {
    const all = outbox();
    if (all.length === 0) throw new Error('test: plugin received no messages');
    return all[all.length - 1]!;
  };
  return { plugin, fakeWindow: stub.fakeWindow, outbox, lastMessage };
};

const makeHandshake = (
  pluginId: string,
  versionOverride?: number,
): unknown => ({
  type: 'reui:handshake',
  version: versionOverride ?? PROTOCOL_VERSION,
  payload: { pluginId, sdkVersion: '0.0.0-test' },
});

const makeRequest = (
  id: string,
  method: string,
  params?: unknown,
  versionOverride?: number,
): unknown =>
  params === undefined
    ? {
        type: 'reui:request',
        version: versionOverride ?? PROTOCOL_VERSION,
        id,
        method,
      }
    : {
        type: 'reui:request',
        version: versionOverride ?? PROTOCOL_VERSION,
        id,
        method,
        params,
      };

const makeNotify = (method: string, params?: unknown): unknown =>
  params === undefined
    ? { type: 'reui:notify', version: PROTOCOL_VERSION, method }
    : { type: 'reui:notify', version: PROTOCOL_VERSION, method, params };

// ── 全局 lifecycle ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval'],
  });
  iframeQueue.length = 0;
  EventBus.__resetForTests();
  AuthService.__resetForTests();
  NuiBridge.__resetForTests();
  HeartbeatMonitor.__resetForTests();
  LayerSystem.__resetForTests();
  PluginManager.__resetForTests();
  PostMessageRouter.__resetForTests();
  // 先把 PluginManager 单例用 stub iframeFactory 拉起，确保后续
  // PostMessageRouter.getInstance() 拿到的是同一个绑定了 stub 的 manager。
  installStubManager();
});

afterEach(() => {
  PostMessageRouter.__resetForTests();
  PluginManager.__resetForTests();
  LayerSystem.__resetForTests();
  HeartbeatMonitor.__resetForTests();
  NuiBridge.__resetForTests();
  AuthService.__resetForTests();
  EventBus.__resetForTests();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ── 1. handshake 路径 ───────────────────────────────────────────────────

describe('PostMessageRouter.handshake', () => {
  it('should mark plugin ready and reply handshake-ack with non-empty runtimeOrigin when handshake is valid', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });
    const markReady = vi.spyOn(PluginManager.getInstance(), 'markReady');

    // act
    router.handlePluginMessage(plugin, makeHandshake('plugin-a'));

    // assert
    expect(markReady).toHaveBeenCalledWith('plugin-a');
    const ack = lastMessage();
    expect(ack.type).toBe('reui:handshake-ack');
    expect(ack['version']).toBe(PROTOCOL_VERSION);
    const payload = ack['payload'];
    expect(payload).toMatchObject({
      pluginId: 'plugin-a',
    });
    const runtimeOrigin = (payload as { runtimeOrigin: unknown }).runtimeOrigin;
    expect(typeof runtimeOrigin).toBe('string');
    expect(runtimeOrigin).not.toBe('');
  });

  it('should reply handshake-reject UNKNOWN_PLUGIN and not mark ready when handshake.pluginId differs from registered id', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });
    const markReady = vi.spyOn(PluginManager.getInstance(), 'markReady');

    // act
    router.handlePluginMessage(plugin, makeHandshake('plugin-b'));

    // assert
    const reject = lastMessage();
    expect(reject.type).toBe('reui:handshake-reject');
    expect(reject['payload']).toMatchObject({ code: 'UNKNOWN_PLUGIN' });
    expect(markReady).not.toHaveBeenCalled();
  });

  it('should reply handshake-reject VERSION_MISMATCH when raw handshake carries a different protocol version', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(plugin, makeHandshake('plugin-a', 999));

    // assert
    const reject = lastMessage();
    expect(reject.type).toBe('reui:handshake-reject');
    expect(reject['payload']).toMatchObject({ code: 'VERSION_MISMATCH' });
  });
});

// ── 2. request 路径 ─────────────────────────────────────────────────────

describe('PostMessageRouter.request', () => {
  it('should reply success response with the handler result and pass through the request id when method is registered', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });
    router.registerHandler('demo:echo', ({ params }) => ({ echoed: params }));

    // act
    router.handlePluginMessage(plugin, makeRequest('req-1', 'demo:echo', { x: 1 }));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    const res = lastMessage();
    expect(res).toMatchObject({
      type: 'reui:response',
      id: 'req-1',
      success: true,
      result: { echoed: { x: 1 } },
    });
  });

  it('should reply METHOD_NOT_FOUND when the requested method is not registered', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-2', 'unknown:method'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-2',
      success: false,
      error: { code: 'METHOD_NOT_FOUND' },
    });
  });

  it('should reply CAPABILITY_DENIED when the registered method requires a capability the plugin does not declare', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: [],
    });
    router.registerHandler('secure:doIt', () => 'ok', 'secure.write');

    // act
    router.handlePluginMessage(plugin, makeRequest('req-3', 'secure:doIt'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-3',
      success: false,
      error: { code: 'CAPABILITY_DENIED' },
    });
  });

  it('should invoke the handler and reply success when the plugin declares the required capability', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['secure.write'],
    });
    const handler = vi.fn(() => 42);
    router.registerHandler('secure:doIt', handler, 'secure.write');

    // act
    router.handlePluginMessage(plugin, makeRequest('req-4', 'secure:doIt'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(handler).toHaveBeenCalledTimes(1);
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-4',
      success: true,
      result: 42,
    });
  });

  it('should propagate code/message from a handler error that carries a known ErrorCode', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });
    router.registerHandler('demo:fail', () => {
      const err = Object.assign(new Error('quota exceeded'), {
        code: 'PAYLOAD_TOO_LARGE' as const,
      });
      return Promise.reject(err);
    });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-5', 'demo:fail'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-5',
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'quota exceeded' },
    });
  });

  it('should reply RUNTIME_ERROR with the original message when a plain Error is thrown by the handler', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });
    router.registerHandler('demo:boom', () => {
      throw new Error('nope');
    });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-6', 'demo:boom'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-6',
      success: false,
      error: { code: 'RUNTIME_ERROR', message: 'nope' },
    });
  });

  it('should reply VERSION_MISMATCH with details.expected and details.got when a request carries a wrong protocol version', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-7', 'anything', undefined, 999));

    // assert
    const res = lastMessage();
    expect(res).toMatchObject({
      type: 'reui:response',
      id: 'req-7',
      success: false,
      error: { code: 'VERSION_MISMATCH' },
    });
    const error = res['error'] as { details?: { expected?: unknown; got?: unknown } };
    expect(error.details).toEqual({ expected: PROTOCOL_VERSION, got: 999 });
  });
});

// ── 3. notify 路径 ──────────────────────────────────────────────────────

describe('PostMessageRouter.notify', () => {
  it('should invoke the handler but never send a response back to the plugin when message type is reui:notify', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, fakeWindow } = await loadPlugin({ id: 'plugin-a' });
    const handler = vi.fn(() => undefined);
    router.registerHandler('demo:fire', handler);

    // act
    router.handlePluginMessage(plugin, makeNotify('demo:fire', { a: 1 }));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fakeWindow.postMessage).not.toHaveBeenCalled();
  });

  it('should emit router:error and not send a response when a notify handler throws', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, fakeWindow } = await loadPlugin({ id: 'plugin-a' });
    const errorEvents = vi.fn();
    EventBus.getInstance().on('router:error', errorEvents);
    router.registerHandler('demo:bad', () => {
      throw new Error('notify boom');
    });

    // act
    router.handlePluginMessage(plugin, makeNotify('demo:bad'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(errorEvents).toHaveBeenCalledTimes(1);
    expect(fakeWindow.postMessage).not.toHaveBeenCalled();
  });
});

// ── 4. pong 路径 ────────────────────────────────────────────────────────

describe('PostMessageRouter.pong', () => {
  it('should forward pong to heartbeat.handlePong with the plugin id when receiving reui:pong', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin } = await loadPlugin({ id: 'plugin-a' });
    const handlePong = vi.spyOn(HeartbeatMonitor.getInstance(), 'handlePong');

    // act
    router.handlePluginMessage(plugin, {
      type: 'reui:pong',
      version: PROTOCOL_VERSION,
      pluginId: 'plugin-a',
      timestamp: 123,
    });

    // assert
    expect(handlePong).toHaveBeenCalledTimes(1);
    expect(handlePong).toHaveBeenCalledWith('plugin-a');
  });
});

// ── 5. 订阅 / 事件 路径 ─────────────────────────────────────────────────

describe('PostMessageRouter event subscription', () => {
  it('should push reui:push to the plugin when a subscribed event is emitted on the EventBus', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, outbox } = await loadPlugin({ id: 'plugin-a' });
    router.handlePluginMessage(
      plugin,
      makeRequest('sub-1', 'event:subscribe', { event: 'plugin:hello' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // act
    EventBus.getInstance().emit('plugin:hello', { greeting: 'hi' });

    // assert
    const pushes = outbox().filter((m) => m.type === 'reui:push');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      type: 'reui:push',
      event: 'plugin:hello',
      payload: { greeting: 'hi' },
    });
  });

  it('should stop pushing further events to the plugin once event:unsubscribe is processed', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, outbox } = await loadPlugin({ id: 'plugin-a' });
    router.handlePluginMessage(
      plugin,
      makeRequest('sub-1', 'event:subscribe', { event: 'plugin:hello' }),
    );
    await vi.advanceTimersByTimeAsync(0);
    router.handlePluginMessage(
      plugin,
      makeRequest('unsub-1', 'event:unsubscribe', { event: 'plugin:hello' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // act
    EventBus.getInstance().emit('plugin:hello', { greeting: 'hi' });

    // assert
    expect(outbox().filter((m) => m.type === 'reui:push')).toHaveLength(0);
  });

  it('should auto-clean all subscriptions for a plugin when PluginManager.unloadPlugin emits plugin:unloaded', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, outbox } = await loadPlugin({ id: 'plugin-a' });
    router.handlePluginMessage(
      plugin,
      makeRequest('sub-1', 'event:subscribe', { event: 'plugin:hello' }),
    );
    await vi.advanceTimersByTimeAsync(0);
    PluginManager.getInstance().unloadPlugin('plugin-a');

    // act
    EventBus.getInstance().emit('plugin:hello', { greeting: 'hi' });

    // assert
    expect(outbox().filter((m) => m.type === 'reui:push')).toHaveLength(0);
  });
});

// ── 6. 内置 method 抽样 ─────────────────────────────────────────────────

describe('PostMessageRouter built-in methods', () => {
  it('should reply with the AuthService.getUser() result when the plugin requests auth:getUser', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });
    AuthService.getInstance().updateUser({
      id: 'u-1',
      name: 'tester',
      identifiers: ['steam:abc'],
    });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-user', 'auth:getUser'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-user',
      success: true,
      result: { id: 'u-1', name: 'tester' },
    });
  });

  it('should reply CAPABILITY_DENIED for nui:send when the plugin lacks runtime.message and otherwise call NuiBridge.sendToGame', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: [],
    });
    const sendToGame = vi
      .spyOn(NuiBridge.getInstance(), 'sendToGame')
      .mockResolvedValue({ ok: true });

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-nui', 'nui:send', { event: 'open-menu' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(sendToGame).not.toHaveBeenCalled();
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-nui',
      success: false,
      error: { code: 'CAPABILITY_DENIED' },
    });
  });

  it('should call NuiBridge.sendToGame with the event name and data when the plugin declares runtime.message and requests nui:send', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['runtime.message'],
    });
    const sendToGame = vi
      .spyOn(NuiBridge.getInstance(), 'sendToGame')
      .mockResolvedValue({ ok: true });

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-nui-ok', 'nui:send', {
        event: 'open-menu',
        data: { which: 'main' },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(sendToGame).toHaveBeenCalledWith('open-menu', { which: 'main' });
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-nui-ok',
      success: true,
    });
  });

  it('should call PluginManager.showPlugin when the plugin declares plugin.self.visibility and requests plugin:show', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['plugin.self.visibility'],
    });
    const showPlugin = vi.spyOn(PluginManager.getInstance(), 'showPlugin');

    // act
    router.handlePluginMessage(plugin, makeRequest('req-show', 'plugin:show'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(showPlugin).toHaveBeenCalledWith('plugin-a');
  });

  it('should reply INVALID_PARAMS when auth:hasPermission is called without a permission field', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-bad', 'auth:hasPermission', {}),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-bad',
      success: false,
      error: { code: 'INVALID_PARAMS' },
    });
  });
});

// ── 7. 扩展覆盖：unregister / 不识别消息丢弃 / dispose ─────────────────

describe('PostMessageRouter.unregisterHandler', () => {
  it('should reply METHOD_NOT_FOUND once a previously registered method is unregistered', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });
    router.registerHandler('demo:once', () => 'first');
    router.unregisterHandler('demo:once');

    // act
    router.handlePluginMessage(plugin, makeRequest('req-x', 'demo:once'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-x',
      success: false,
      error: { code: 'METHOD_NOT_FOUND' },
    });
  });
});

describe('PostMessageRouter unrecognized envelopes', () => {
  it('should silently drop a message when its envelope fails Zod validation', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, fakeWindow } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(plugin, { type: 'reui:request' /* missing id/method/version */ });

    // assert
    expect(fakeWindow.postMessage).not.toHaveBeenCalled();
  });

  it('should silently drop a well-formed reui message whose type is not a plugin-originated one (e.g. reui:response)', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, fakeWindow } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(plugin, {
      type: 'reui:response',
      version: PROTOCOL_VERSION,
      id: 'x',
      success: true,
      result: null,
    });

    // assert
    expect(fakeWindow.postMessage).not.toHaveBeenCalled();
  });
});

describe('PostMessageRouter additional built-ins', () => {
  it('should call AuthService.hasAllPermissions and reply with the boolean when auth:checkPermissions params include a string array', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });
    AuthService.getInstance().updatePermissions(['x', 'y']);

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-cp', 'auth:checkPermissions', { permissions: ['x', 'y'] }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-cp',
      success: true,
      result: true,
    });
  });

  it('should reply INVALID_PARAMS for auth:checkPermissions when the permissions field is not an array of strings', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-cp-bad', 'auth:checkPermissions', { permissions: 'x' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-cp-bad',
      success: false,
      error: { code: 'INVALID_PARAMS' },
    });
  });

  it('should return the current AuthService.getRoles() snapshot when auth:getRoles is invoked', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });
    AuthService.getInstance().updateRoles(['admin', 'staff']);

    // act
    router.handlePluginMessage(plugin, makeRequest('req-roles', 'auth:getRoles'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-roles',
      success: true,
      result: ['admin', 'staff'],
    });
  });

  it('should emit on the EventBus when event:emit is invoked by a plugin that declares events.emit', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['events.emit'],
    });
    const handler = vi.fn();
    EventBus.getInstance().on('plugin:custom', handler);

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-emit', 'event:emit', {
        event: 'plugin:custom',
        payload: { hi: true },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(handler).toHaveBeenCalledWith({ hi: true });
  });

  it('should reply INVALID_PARAMS for event:subscribe when event field is missing', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-sub-bad', 'event:subscribe', {}));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-sub-bad',
      success: false,
      error: { code: 'INVALID_PARAMS' },
    });
  });

  it('should reply INVALID_PARAMS when event:subscribe is given an event name with an unknown namespace', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-sub-ns', 'event:subscribe', { event: 'unknown:thing' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-sub-ns',
      success: false,
      error: { code: 'INVALID_PARAMS' },
    });
  });

  it('should be idempotent when event:subscribe is called twice for the same event so a single emit only produces one push', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, outbox } = await loadPlugin({ id: 'plugin-a' });
    router.handlePluginMessage(
      plugin,
      makeRequest('s1', 'event:subscribe', { event: 'plugin:dup' }),
    );
    router.handlePluginMessage(
      plugin,
      makeRequest('s2', 'event:subscribe', { event: 'plugin:dup' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // act
    EventBus.getInstance().emit('plugin:dup', null);

    // assert
    expect(outbox().filter((m) => m.type === 'reui:push')).toHaveLength(1);
  });

  it('should silently no-op when event:unsubscribe targets an event the plugin never subscribed to', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('u-noop', 'event:unsubscribe', { event: 'plugin:never' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert: 仍然 ack 成功（unsubscribe 是幂等的）。
    expect(lastMessage()).toMatchObject({ id: 'u-noop', success: true });
  });

  it('should reply with the plugin manifest when plugin:getConfig is invoked', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['x'],
    });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-cfg', 'plugin:getConfig'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-cfg',
      success: true,
      result: { id: 'plugin-a', layer: 'hud', permissions: ['x'] },
    });
  });

  it('should call PluginManager.hidePlugin when the plugin declares plugin.self.visibility and requests plugin:hide', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['plugin.self.visibility'],
    });
    const hidePlugin = vi.spyOn(PluginManager.getInstance(), 'hidePlugin');

    // act
    router.handlePluginMessage(plugin, makeRequest('req-hide', 'plugin:hide'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(hidePlugin).toHaveBeenCalledWith('plugin-a');
  });

  it('should reply INVALID_PARAMS for nui:send when the event field is missing', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['runtime.message'],
    });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-nui-bad', 'nui:send', {}));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-nui-bad',
      success: false,
      error: { code: 'INVALID_PARAMS' },
    });
  });

  it('should reply RUNTIME_ERROR with String(err) when a handler throws a non-Error value', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });
    router.registerHandler('demo:nonError', () => {
      // 抛字符串——既非 Error、又非 CodedError，触发 String(err) 兜底分支。
      throw 'literal-string-error'; // eslint-disable-line no-throw-literal
    });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-ne', 'demo:nonError'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-ne',
      success: false,
      error: { code: 'RUNTIME_ERROR', message: 'literal-string-error' },
    });
  });
});

describe('PostMessageRouter param guard branches', () => {
  it('should reply INVALID_PARAMS for auth:hasPermission when the request has no params field at all', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-np', 'auth:hasPermission'));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-np',
      success: false,
      error: { code: 'INVALID_PARAMS' },
    });
  });

  it('should reply INVALID_PARAMS for auth:checkPermissions when the array contains a non-string element', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-cpm', 'auth:checkPermissions', { permissions: ['x', 1] }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-cpm',
      success: false,
      error: { code: 'INVALID_PARAMS' },
    });
  });

  it('should reply INVALID_PARAMS for event:unsubscribe when event field is missing', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-uns', 'event:unsubscribe', {}));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-uns',
      success: false,
      error: { code: 'INVALID_PARAMS' },
    });
  });

  it('should reply INVALID_PARAMS for event:emit when event field is missing', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['events.emit'],
    });

    // act
    router.handlePluginMessage(plugin, makeRequest('req-emit-bad', 'event:emit', {}));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      id: 'req-emit-bad',
      success: false,
      error: { code: 'INVALID_PARAMS' },
    });
  });

  it('should be a no-op when event:unsubscribe targets a different event than the one the plugin subscribed to', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, outbox } = await loadPlugin({ id: 'plugin-a' });
    router.handlePluginMessage(
      plugin,
      makeRequest('s-1', 'event:subscribe', { event: 'plugin:keep' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('u-other', 'event:unsubscribe', { event: 'plugin:other' }),
    );
    await vi.advanceTimersByTimeAsync(0);
    EventBus.getInstance().emit('plugin:keep', { kept: true });

    // assert: 原订阅依旧生效。
    expect(outbox().filter((m) => m.type === 'reui:push')).toHaveLength(1);
  });

  it('should silently ignore plugin:unloaded for a plugin that never subscribed to anything', async () => {
    // arrange
    PostMessageRouter.getInstance(); // 触发 plugin:unloaded 监听器注册。
    const { plugin } = await loadPlugin({ id: 'plugin-b' });

    // act + assert
    expect(() =>
      PluginManager.getInstance().unloadPlugin(plugin.id),
    ).not.toThrow();
  });
});

describe('PostMessageRouter raw envelope guards', () => {
  it('should silently drop a non-object payload such as a bare string', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, fakeWindow } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(plugin, 'not-an-object');

    // assert
    expect(fakeWindow.postMessage).not.toHaveBeenCalled();
  });

  it('should silently drop a record whose type field is not a string', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, fakeWindow } = await loadPlugin({ id: 'plugin-a' });

    // act
    router.handlePluginMessage(plugin, { type: 123, version: PROTOCOL_VERSION });

    // assert
    expect(fakeWindow.postMessage).not.toHaveBeenCalled();
  });
});

describe('PostMessageRouter.dispose', () => {
  it('should detach the plugin:unloaded listener so subsequent unloads do not throw and clear all subscriptions', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin } = await loadPlugin({ id: 'plugin-a' });
    router.handlePluginMessage(
      plugin,
      makeRequest('sub-1', 'event:subscribe', { event: 'plugin:bye' }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // act
    router.dispose();

    // assert: dispose 后 EventBus 上不应再有该插件的订阅。
    expect(EventBus.getInstance().pluginSubscriptionCount('plugin-a')).toBe(0);
  });
});

// ── 8. plugin:saveState / plugin:restoreState（Stage A2.3） ───────────

describe('PostMessageRouter.plugin:saveState / restoreState', () => {
  it('should persist payload via saveState handler when payload is valid', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['plugin.self.state'],
    });
    const payload = { theme: 'dark' };

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-save', 'plugin:saveState', { payload }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-save',
      success: true,
      result: { ok: true },
    });
    expect(PluginManager.getInstance().loadState('plugin-a')).toEqual(payload);
  });

  it('should reply PAYLOAD_TOO_LARGE error response when saveState payload exceeds 1MB', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['plugin.self.state'],
    });
    const huge = { blob: 'y'.repeat(1.1 * 1024 * 1024) };

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-big', 'plugin:saveState', { payload: huge }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-big',
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });

  it('should restore payload null when no state has been stored for the plugin', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['plugin.self.state'],
    });

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-restore', 'plugin:restoreState'),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-restore',
      success: true,
      result: { payload: null },
    });
  });

  it('should restore the prior payload when restoreState follows a successful saveState', async () => {
    // arrange
    const router = PostMessageRouter.getInstance();
    const { plugin, lastMessage } = await loadPlugin({
      id: 'plugin-a',
      permissions: ['plugin.self.state'],
    });
    router.handlePluginMessage(
      plugin,
      makeRequest('req-save', 'plugin:saveState', { payload: { v: 7 } }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // act
    router.handlePluginMessage(
      plugin,
      makeRequest('req-restore', 'plugin:restoreState'),
    );
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(lastMessage()).toMatchObject({
      type: 'reui:response',
      id: 'req-restore',
      success: true,
      result: { payload: { v: 7 } },
    });
  });

  it('should expose PluginManagerError as an importable class with a code property', () => {
    // arrange
    const err = new PluginManagerError('PLUGIN_NOT_FOUND', 'absent');

    // act + assert
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('PLUGIN_NOT_FOUND');
  });
});
