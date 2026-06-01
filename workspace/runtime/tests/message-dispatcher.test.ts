/**
 * 单元测试：MessageDispatcher（RFC-001 §3.2）。
 *
 * 关键约束：
 *   - jsdom 环境；通过 window.dispatchEvent(new MessageEvent(...)) 走真实
 *     挂载路径，仅在 jsdom 默认 source 不可控时用 Object.defineProperty
 *     覆写 event.source；
 *   - 已注册的 iframe.contentWindow 通过 PluginManager + iframeFactory
 *     注入 stub iframe 拿到；
 *   - fake timers 仅 fake setInterval/clearInterval/Date，避免影响
 *     window.dispatchEvent 的同步触发。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/event-bus';
import { HeartbeatMonitor } from '../src/heartbeat-monitor';
import { NuiBridge } from '../src/nui-bridge';
import {
  PluginManager,
  type PluginInstance,
  type PluginManifestMinimal,
} from '../src/plugin-manager';
import {
  MessageDispatcher,
  type MessageDispatcherRouterLike,
} from '../src/message-dispatcher';
import { LayerSystem } from '../src/layer-system';

interface WindowProxyStub {
  postMessage: ReturnType<typeof vi.fn>;
}

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

const makeManifest = (
  overrides: Partial<PluginManifestMinimal> = {},
): PluginManifestMinimal => ({
  id: 'plugin-a',
  entry: 'https://plugin.example/index.html',
  layer: 'hud',
  ...overrides,
});

/** 构造一个携带指定 source 的 MessageEvent 并 dispatch 到 window。 */
const dispatchMessage = (data: unknown, source: MessageEventSource | null): void => {
  const event = new MessageEvent('message', { data });
  // jsdom 不允许通过 init dict 设置 source，且默认是 null。
  // 通过 defineProperty 覆写以模拟真实场景。
  Object.defineProperty(event, 'source', { value: source, configurable: true });
  window.dispatchEvent(event);
};

/**
 * 必须在 MessageDispatcher.getInstance() 之前调用——否则 dispatcher 会先把
 * PluginManager.getInstance() 用默认 iframeFactory 拉起，第二次再传
 * iframeFactory 会被单例忽略，导致用真实 jsdom iframe.contentWindow 而不是
 * 我们的 stub 作为 source 注册。
 */
const installStubPluginManager = (queue: HTMLIFrameElement[]): PluginManager => {
  return PluginManager.getInstance({
    iframeFactory: () => {
      const next = queue.shift();
      if (!next) throw new Error('test setup: iframe queue exhausted');
      return next;
    },
  });
};

const setupPluginInstance = async (id = 'plugin-a'): Promise<{
  plugin: PluginInstance;
  fakeWindow: WindowProxyStub;
}> => {
  const stub = makeStubIframe();
  const manager = installStubPluginManager([stub.iframe]);
  const plugin = await manager.loadPlugin(makeManifest({ id }));
  return { plugin, fakeWindow: stub.fakeWindow };
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'Date'],
  });
  EventBus.__resetForTests();
  HeartbeatMonitor.__resetForTests();
  NuiBridge.__resetForTests();
  LayerSystem.__resetForTests();
  PluginManager.__resetForTests();
  MessageDispatcher.__resetForTests();
});

afterEach(() => {
  MessageDispatcher.__resetForTests();
  PluginManager.__resetForTests();
  LayerSystem.__resetForTests();
  NuiBridge.__resetForTests();
  HeartbeatMonitor.__resetForTests();
  EventBus.__resetForTests();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('MessageDispatcher.start', () => {
  it('should register exactly one message listener so a single dispatched event triggers dispatch only once when start is called twice', async () => {
    // arrange
    const dispatcher = MessageDispatcher.getInstance();
    const nuiSpy = vi.spyOn(NuiBridge.getInstance(), 'handleGameMessage');

    // act
    dispatcher.start();
    dispatcher.start();
    dispatchMessage({ type: 'reui:init', resourceName: 'res' }, null);

    // assert
    expect(dispatcher.isRunning()).toBe(true);
    expect(nuiSpy).toHaveBeenCalledTimes(1);
  });
});

describe('MessageDispatcher.stop', () => {
  it('should unbind the listener so later dispatched messages do not trigger any branch', async () => {
    // arrange
    const dispatcher = MessageDispatcher.getInstance();
    const nuiSpy = vi.spyOn(NuiBridge.getInstance(), 'handleGameMessage');
    dispatcher.start();

    // act
    dispatcher.stop();
    dispatchMessage({ type: 'reui:init', resourceName: 'res' }, null);

    // assert
    expect(dispatcher.isRunning()).toBe(false);
    expect(nuiSpy).not.toHaveBeenCalled();
  });
});

describe('MessageDispatcher NUI branch', () => {
  it('should forward event.data to nuiBridge.handleGameMessage when event.source is null', async () => {
    // arrange
    const dispatcher = MessageDispatcher.getInstance();
    const nuiSpy = vi.spyOn(NuiBridge.getInstance(), 'handleGameMessage');
    const router: MessageDispatcherRouterLike = {
      handlePluginMessage: vi.fn(),
    };
    dispatcher.setRouter(router);
    dispatcher.start();
    const data = { type: 'reui:init', resourceName: 'cfx-res' };

    // act
    dispatchMessage(data, null);

    // assert
    expect(nuiSpy).toHaveBeenCalledTimes(1);
    expect(nuiSpy).toHaveBeenCalledWith(data);
    expect(router.handlePluginMessage).not.toHaveBeenCalled();
  });

  it('should forward event.data to nuiBridge.handleGameMessage when event.source equals the runtime window', async () => {
    // arrange
    const dispatcher = MessageDispatcher.getInstance();
    const nuiSpy = vi.spyOn(NuiBridge.getInstance(), 'handleGameMessage');
    dispatcher.start();
    const data = { type: 'nui:hello', payload: 1 };

    // act
    dispatchMessage(data, window);

    // assert
    expect(nuiSpy).toHaveBeenCalledTimes(1);
    expect(nuiSpy).toHaveBeenCalledWith(data);
  });
});

describe('MessageDispatcher iframe branch', () => {
  it('should call router.handlePluginMessage with the matching plugin and data when source is a registered iframe contentWindow and data is a reui envelope', async () => {
    // arrange
    const { plugin, fakeWindow } = await setupPluginInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const router: MessageDispatcherRouterLike = {
      handlePluginMessage: vi.fn(),
    };
    dispatcher.setRouter(router);
    dispatcher.start();
    const data = { type: 'reui:request', method: 'http:request', id: '1' };

    // act
    dispatchMessage(data, fakeWindow as unknown as MessageEventSource);

    // assert
    expect(router.handlePluginMessage).toHaveBeenCalledTimes(1);
    expect(router.handlePluginMessage).toHaveBeenCalledWith(plugin, data);
  });

  it('should drop the event silently without throwing when data from a registered iframe is not an object', async () => {
    // arrange
    const { fakeWindow } = await setupPluginInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const router: MessageDispatcherRouterLike = {
      handlePluginMessage: vi.fn(),
    };
    const nuiSpy = vi.spyOn(NuiBridge.getInstance(), 'handleGameMessage');
    dispatcher.setRouter(router);
    dispatcher.start();

    // act
    dispatchMessage('hello', fakeWindow as unknown as MessageEventSource);

    // assert
    expect(router.handlePluginMessage).not.toHaveBeenCalled();
    expect(nuiSpy).not.toHaveBeenCalled();
  });

  it('should drop the event when data.type is not prefixed with "reui:"', async () => {
    // arrange
    const { fakeWindow } = await setupPluginInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const router: MessageDispatcherRouterLike = {
      handlePluginMessage: vi.fn(),
    };
    dispatcher.setRouter(router);
    dispatcher.start();

    // act
    dispatchMessage(
      { type: 'custom:event', payload: {} },
      fakeWindow as unknown as MessageEventSource,
    );

    // assert
    expect(router.handlePluginMessage).not.toHaveBeenCalled();
  });

  it('should drop the event when source is neither null/window nor a registered iframe', async () => {
    // arrange
    await setupPluginInstance(); // registers a plugin so manager is non-empty
    const dispatcher = MessageDispatcher.getInstance();
    const router: MessageDispatcherRouterLike = {
      handlePluginMessage: vi.fn(),
    };
    const nuiSpy = vi.spyOn(NuiBridge.getInstance(), 'handleGameMessage');
    dispatcher.setRouter(router);
    dispatcher.start();
    const stranger = { postMessage: vi.fn() } as unknown as MessageEventSource;

    // act
    dispatchMessage({ type: 'reui:request' }, stranger);

    // assert
    expect(router.handlePluginMessage).not.toHaveBeenCalled();
    expect(nuiSpy).not.toHaveBeenCalled();
  });
});

describe('MessageDispatcher router lifecycle', () => {
  it('should not throw and not invoke nui branch when router is unset and a registered iframe sends a reui envelope', async () => {
    // arrange
    const { fakeWindow } = await setupPluginInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const nuiSpy = vi.spyOn(NuiBridge.getInstance(), 'handleGameMessage');
    dispatcher.start();

    // act + assert
    expect(() =>
      dispatchMessage(
        { type: 'reui:request' },
        fakeWindow as unknown as MessageEventSource,
      ),
    ).not.toThrow();
    expect(nuiSpy).not.toHaveBeenCalled();
  });

  it('should route to the newly installed router after setRouter is called', async () => {
    // arrange
    const { plugin, fakeWindow } = await setupPluginInstance();
    const dispatcher = MessageDispatcher.getInstance();
    dispatcher.start();
    const router: MessageDispatcherRouterLike = {
      handlePluginMessage: vi.fn(),
    };

    // act
    dispatcher.setRouter(router);
    const data = { type: 'reui:request' };
    dispatchMessage(data, fakeWindow as unknown as MessageEventSource);

    // assert
    expect(router.handlePluginMessage).toHaveBeenCalledWith(plugin, data);
  });
});

describe('MessageDispatcher constructor guards', () => {
  it('should throw when no window is provided and globalThis.window is undefined', async () => {
    // arrange
    const originalWindow = globalThis.window;
    // 模拟非 DOM 环境：临时移除 globalThis.window。
    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
    });

    try {
      // act + assert
      expect(() => new MessageDispatcher()).toThrow(/no window available/);
    } finally {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });
});

describe('MessageDispatcher eventBus failure isolation', () => {
  it('should swallow eventBus.emit failures when reporting dispatcher:error so a faulty bus cannot crash the listener', async () => {
    // arrange
    const { fakeWindow } = await setupPluginInstance();
    const fakeBus = {
      emit: vi.fn(() => {
        throw new Error('bus boom');
      }),
    } as unknown as EventBus;
    const dispatcher = new MessageDispatcher({ eventBus: fakeBus });
    const boom = new Error('router boom');
    const router: MessageDispatcherRouterLike = {
      handlePluginMessage: vi.fn(() => {
        throw boom;
      }),
    };
    dispatcher.setRouter(router);
    dispatcher.start();

    // act + assert
    expect(() =>
      dispatchMessage(
        { type: 'reui:request' },
        fakeWindow as unknown as MessageEventSource,
      ),
    ).not.toThrow();
    expect(fakeBus.emit).toHaveBeenCalledWith('dispatcher:error', {
      error: boom,
      source: 'plugin',
    });
  });
});

describe('MessageDispatcher error isolation', () => {
  it('should not let router exceptions bubble out and should emit dispatcher:error then keep handling further events', async () => {
    // arrange
    const { fakeWindow } = await setupPluginInstance();
    const bus = EventBus.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const errorHandler = vi.fn();
    bus.on('dispatcher:error', errorHandler);
    const boom = new Error('router boom');
    let calls = 0;
    const router: MessageDispatcherRouterLike = {
      handlePluginMessage: vi.fn(() => {
        calls += 1;
        if (calls === 1) throw boom;
      }),
    };
    dispatcher.setRouter(router);
    dispatcher.start();

    // act
    expect(() =>
      dispatchMessage(
        { type: 'reui:request', n: 1 },
        fakeWindow as unknown as MessageEventSource,
      ),
    ).not.toThrow();
    dispatchMessage(
      { type: 'reui:request', n: 2 },
      fakeWindow as unknown as MessageEventSource,
    );

    // assert
    expect(router.handlePluginMessage).toHaveBeenCalledTimes(2);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith({ error: boom, source: 'plugin' });
  });

  it('should not let nuiBridge exceptions bubble out and should emit dispatcher:error then keep handling further events', async () => {
    // arrange
    const bus = EventBus.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const errorHandler = vi.fn();
    bus.on('dispatcher:error', errorHandler);
    const boom = new Error('nui boom');
    let calls = 0;
    const nuiSpy = vi
      .spyOn(NuiBridge.getInstance(), 'handleGameMessage')
      .mockImplementation(() => {
        calls += 1;
        if (calls === 1) throw boom;
      });
    dispatcher.start();

    // act
    expect(() =>
      dispatchMessage({ type: 'reui:init', resourceName: 'r' }, null),
    ).not.toThrow();
    dispatchMessage({ type: 'reui:init', resourceName: 'r' }, null);

    // assert
    expect(nuiSpy).toHaveBeenCalledTimes(2);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith({ error: boom, source: 'nui' });
  });
});
