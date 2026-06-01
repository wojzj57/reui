/**
 * 单元测试：PluginManager（Stage A1）。
 *
 * 关键约束：
 *   - 用 iframeFactory 注入 stub iframe（通过 Object.defineProperty 暴露
 *     fake contentWindow），避免 jsdom 实际加载 iframe 资源；
 *   - 所有时序通过 fake timers 推进；
 *   - 每条用例严格 AAA、单意图。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/event-bus';
import { HeartbeatMonitor } from '../src/heartbeat-monitor';
import {
  PluginManager,
  type PluginManifestMinimal,
} from '../src/plugin-manager';

interface WindowProxyStub {
  postMessage: ReturnType<typeof vi.fn>;
}

const makeStubIframe = (): {
  iframe: HTMLIFrameElement;
  postMessage: WindowProxyStub['postMessage'];
} => {
  const iframe = document.createElement('iframe');
  const postMessage = vi.fn();
  const fakeWindow: WindowProxyStub = { postMessage };
  Object.defineProperty(iframe, 'contentWindow', {
    value: fakeWindow,
    configurable: true,
  });
  return { iframe, postMessage };
};

const makeManifest = (
  overrides: Partial<PluginManifestMinimal> = {},
): PluginManifestMinimal => ({
  id: 'plugin-a',
  entry: 'https://plugin.example/index.html',
  layer: 'hud',
  ...overrides,
});

const setupManager = (): {
  manager: PluginManager;
  bus: EventBus;
  heartbeat: HeartbeatMonitor;
  iframe: HTMLIFrameElement;
  postMessage: WindowProxyStub['postMessage'];
} => {
  const stub = makeStubIframe();
  const bus = EventBus.getInstance();
  const heartbeat = HeartbeatMonitor.getInstance(bus);
  const manager = new PluginManager({
    eventBus: bus,
    heartbeat,
    iframeFactory: () => stub.iframe,
  });
  return {
    manager,
    bus,
    heartbeat,
    iframe: stub.iframe,
    postMessage: stub.postMessage,
  };
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
  });
  EventBus.__resetForTests();
  HeartbeatMonitor.__resetForTests();
  PluginManager.__resetForTests();
});

afterEach(() => {
  PluginManager.__resetForTests();
  HeartbeatMonitor.__resetForTests();
  EventBus.__resetForTests();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('PluginManager.loadPlugin', () => {
  it('should append iframe to container with state loading and matching id when called with a fresh manifest', () => {
    // arrange
    const { manager, iframe } = setupManager();
    const manifest = makeManifest();

    // act
    const instance = manager.loadPlugin(manifest);

    // assert
    expect(document.body.contains(iframe)).toBe(true);
    expect(instance.id).toBe(manifest.id);
    expect(instance.manifest).toBe(manifest);
    expect(instance.state).toBe('loading');
  });

  it('should throw and keep the existing instance unchanged when loading the same id twice', () => {
    // arrange
    const { manager } = setupManager();
    const manifest = makeManifest();
    const original = manager.loadPlugin(manifest);

    // act + assert
    expect(() => manager.loadPlugin(manifest)).toThrow(
      /already loaded/,
    );
    expect(manager.getPlugin(manifest.id)).toBe(original);
  });

  it('should throw and not pollute plugins map when entry URL is invalid', () => {
    // arrange
    const { manager } = setupManager();
    const manifest = makeManifest({ id: 'bad', entry: 'http://[::bad' });

    // act + assert
    expect(() => manager.loadPlugin(manifest)).toThrow(/invalid entry/);
    expect(manager.getPlugin('bad')).toBeUndefined();
  });
});

describe('PluginManager.findBySource', () => {
  it('should return the matching instance when source equals the iframe contentWindow and undefined otherwise', () => {
    // arrange
    const { manager, iframe } = setupManager();
    const instance = manager.loadPlugin(makeManifest());
    const otherSource = { postMessage: vi.fn() } as unknown as MessageEventSource;

    // act
    const hit = manager.findBySource(
      iframe.contentWindow as unknown as MessageEventSource,
    );
    const missByOther = manager.findBySource(otherSource);
    const missByNull = manager.findBySource(null);

    // assert
    expect(hit).toBe(instance);
    expect(missByOther).toBeUndefined();
    expect(missByNull).toBeUndefined();
  });
});

describe('PluginManager.markReady', () => {
  it('should set state to ready, start heartbeat once and emit plugin:ready when called for an existing plugin', () => {
    // arrange
    const { manager, bus, heartbeat } = setupManager();
    const startSpy = vi.spyOn(heartbeat, 'start');
    const readyHandler = vi.fn();
    bus.on('plugin:ready', readyHandler);
    const instance = manager.loadPlugin(makeManifest());

    // act
    manager.markReady(instance.id);

    // assert
    expect(instance.state).toBe('ready');
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(readyHandler).toHaveBeenCalledWith({ pluginId: instance.id });
  });

  it('should be a no-op and not start heartbeat when called for an unknown id', () => {
    // arrange
    const { manager, heartbeat } = setupManager();
    const startSpy = vi.spyOn(heartbeat, 'start');

    // act
    manager.markReady('nonexistent');

    // assert
    expect(startSpy).not.toHaveBeenCalled();
  });
});

describe('PluginManager.unloadPlugin', () => {
  it('should remove iframe, drop the plugin, stop heartbeat, and emit plugin:unloaded', () => {
    // arrange
    const { manager, bus, heartbeat, iframe } = setupManager();
    const stopSpy = vi.spyOn(heartbeat, 'stop');
    const unloadedHandler = vi.fn();
    bus.on('plugin:unloaded', unloadedHandler);
    const instance = manager.loadPlugin(makeManifest());

    // act
    manager.unloadPlugin(instance.id);

    // assert
    expect(document.body.contains(iframe)).toBe(false);
    expect(manager.getPlugin(instance.id)).toBeUndefined();
    expect(stopSpy).toHaveBeenCalledWith(instance.id);
    expect(unloadedHandler).toHaveBeenCalledWith({ pluginId: instance.id });
  });
});

describe('PluginManager EventBus integration', () => {
  it('should mark plugin as error and emit plugin:error when EventBus emits plugin:crashed for a known plugin', () => {
    // arrange
    const { manager, bus } = setupManager();
    const errorHandler = vi.fn();
    bus.on('plugin:error', errorHandler);
    const instance = manager.loadPlugin(makeManifest());

    // act
    bus.emit('plugin:crashed', { pluginId: instance.id, reason: 'heartbeat-timeout' });

    // assert
    expect(instance.state).toBe('error');
    expect(errorHandler).toHaveBeenCalledWith({
      pluginId: instance.id,
      reason: 'heartbeat-timeout',
    });
  });
});

describe('PluginManager.showPlugin / hidePlugin', () => {
  it('should toggle iframe display, swap state ready<->hidden, pause/resume heartbeat and emit plugin:visibility on each transition', () => {
    // arrange
    const { manager, bus, heartbeat, iframe } = setupManager();
    const pauseSpy = vi.spyOn(heartbeat, 'pause');
    const resumeSpy = vi.spyOn(heartbeat, 'resume');
    const visibilityHandler = vi.fn();
    bus.on('plugin:visibility', visibilityHandler);
    const instance = manager.loadPlugin(makeManifest());
    manager.markReady(instance.id);

    // act
    manager.hidePlugin(instance.id);
    const stateAfterHide = instance.state;
    const displayAfterHide = iframe.style.display;
    manager.showPlugin(instance.id);

    // assert
    expect(stateAfterHide).toBe('hidden');
    expect(displayAfterHide).toBe('none');
    expect(instance.state).toBe('ready');
    expect(iframe.style.display).toBe('');
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(visibilityHandler).toHaveBeenNthCalledWith(1, {
      pluginId: instance.id,
      visible: false,
    });
    expect(visibilityHandler).toHaveBeenNthCalledWith(2, {
      pluginId: instance.id,
      visible: true,
    });
  });
});

describe('PluginManager.getActivePlugins', () => {
  it('should return only instances whose state is ready', () => {
    // arrange
    const bus = EventBus.getInstance();
    const heartbeat = HeartbeatMonitor.getInstance(bus);
    const queue: HTMLIFrameElement[] = [
      makeStubIframe().iframe,
      makeStubIframe().iframe,
      makeStubIframe().iframe,
    ];
    const manager = new PluginManager({
      eventBus: bus,
      heartbeat,
      iframeFactory: () => {
        const next = queue.shift();
        if (!next) throw new Error('test setup: iframe queue exhausted');
        return next;
      },
    });
    const a = manager.loadPlugin(makeManifest({ id: 'a' }));
    const b = manager.loadPlugin(makeManifest({ id: 'b' }));
    manager.loadPlugin(makeManifest({ id: 'c' }));
    manager.markReady(a.id);
    manager.markReady(b.id);
    manager.hidePlugin(b.id);

    // act
    const active = manager.getActivePlugins();

    // assert
    expect(active.map((p) => p.id)).toEqual(['a']);
  });
});

describe('PluginManager.dispose', () => {
  it('should unload all plugins and unsubscribe the crash listener so later plugin:crashed events do not affect remaining plugins', () => {
    // arrange
    const { manager, bus } = setupManager();
    const survivorStub = makeStubIframe();
    // 通过 spy 替换 iframeFactory 不便，这里直接再 load 一个用 stub iframe 的实例。
    const bus2 = bus;
    const heartbeat2 = HeartbeatMonitor.getInstance(bus);
    const survivorManager = new PluginManager({
      eventBus: bus2,
      heartbeat: heartbeat2,
      iframeFactory: () => survivorStub.iframe,
    });
    const survivor = survivorManager.loadPlugin(makeManifest({ id: 'survivor' }));
    const a = manager.loadPlugin(makeManifest({ id: 'a' }));

    // act
    manager.dispose();
    bus.emit('plugin:crashed', { pluginId: survivor.id, reason: 'heartbeat-timeout' });

    // assert
    expect(manager.getPlugin(a.id)).toBeUndefined();
    // dispose 解绑了第一个 manager 的 crash 订阅；survivorManager 的订阅仍在，
    // 因此 survivor 会被 markCrashed → state='error'。
    expect(survivor.state).toBe('error');
    survivorManager.dispose();
  });
});

describe('PluginManager singleton & defaults', () => {
  it('should construct a working instance using document.body, default EventBus, HeartbeatMonitor and iframe factory when no opts are provided', () => {
    // arrange
    const manager = PluginManager.getInstance();

    // act
    const instance = manager.loadPlugin(makeManifest({ id: 'defaults' }));

    // assert
    expect(instance.iframe.dataset.pluginId).toBe('defaults');
    expect(instance.iframe.dataset.layer).toBe('hud');
    expect(document.body.contains(instance.iframe)).toBe(true);
  });

  it('should return the same instance on subsequent getInstance calls', () => {
    // arrange
    const first = PluginManager.getInstance();

    // act
    const second = PluginManager.getInstance();

    // assert
    expect(second).toBe(first);
  });

  it('should call dispose on the existing instance when __resetForTests is invoked while a singleton exists', () => {
    // arrange
    const manager = PluginManager.getInstance();
    const disposeSpy = vi.spyOn(manager, 'dispose');

    // act
    PluginManager.__resetForTests();

    // assert
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('PluginManager unknown-id no-ops', () => {
  it('should be a silent no-op for unloadPlugin / markCrashed / showPlugin / hidePlugin when pluginId is unknown', () => {
    // arrange
    const { manager, bus } = setupManager();
    const handler = vi.fn();
    bus.on('plugin:unloaded', handler);
    bus.on('plugin:error', handler);
    bus.on('plugin:visibility', handler);

    // act
    manager.unloadPlugin('ghost');
    manager.markCrashed('ghost', 'whatever');
    manager.showPlugin('ghost');
    manager.hidePlugin('ghost');

    // assert
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('PluginInstance.postMessage edge cases', () => {
  it('should be a silent no-op when iframe.contentWindow is null', () => {
    // arrange
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentWindow', {
      value: null,
      configurable: true,
    });
    const bus = EventBus.getInstance();
    const heartbeat = HeartbeatMonitor.getInstance(bus);
    const manager = new PluginManager({
      eventBus: bus,
      heartbeat,
      iframeFactory: () => iframe,
    });
    const instance = manager.loadPlugin(makeManifest());

    // act + assert
    expect(() => instance.postMessage({ type: 'reui:hello' })).not.toThrow();
  });

  it('should respect an explicit targetOrigin override when provided', () => {
    // arrange
    const { manager, postMessage } = setupManager();
    const instance = manager.loadPlugin(makeManifest());

    // act
    instance.postMessage({ type: 'reui:hello' }, '*');

    // assert
    expect(postMessage).toHaveBeenCalledWith({ type: 'reui:hello' }, '*');
  });
});

describe('PluginInstance.postMessage', () => {
  it('should forward the message to iframe.contentWindow.postMessage exactly once with the manifest origin as default targetOrigin', () => {
    // arrange
    const { manager, postMessage } = setupManager();
    const instance = manager.loadPlugin(makeManifest());
    const payload = { type: 'reui:hello' };

    // act
    instance.postMessage(payload);

    // assert
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(payload, 'https://plugin.example');
  });
});
