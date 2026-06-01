/**
 * 单元测试：PluginManager（Stage A2）。
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
import { LayerSystem } from '../src/layer-system';
import {
  PluginManager,
  PluginManagerError,
  type ManifestValidator,
  type PluginManifestMinimal,
  type PluginStateStorage,
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

const setupManager = (
  extraOpts: {
    manifestValidator?: ManifestValidator;
    stateStorage?: PluginStateStorage;
  } = {},
): {
  manager: PluginManager;
  bus: EventBus;
  heartbeat: HeartbeatMonitor;
  layerSystem: LayerSystem;
  iframe: HTMLIFrameElement;
  postMessage: WindowProxyStub['postMessage'];
} => {
  const stub = makeStubIframe();
  const bus = EventBus.getInstance();
  const heartbeat = HeartbeatMonitor.getInstance(bus);
  const layerSystem = LayerSystem.getInstance();
  const manager = new PluginManager({
    eventBus: bus,
    heartbeat,
    layerSystem,
    iframeFactory: () => stub.iframe,
    ...extraOpts,
  });
  return {
    manager,
    bus,
    heartbeat,
    layerSystem,
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
  LayerSystem.__resetForTests();
  PluginManager.__resetForTests();
});

afterEach(() => {
  PluginManager.__resetForTests();
  LayerSystem.__resetForTests();
  HeartbeatMonitor.__resetForTests();
  EventBus.__resetForTests();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('PluginManager.loadPlugin', () => {
  it('should append iframe to container with state loading and matching id when called with a fresh manifest', async () => {
    // arrange
    const { manager, iframe } = setupManager();
    const manifest = makeManifest();

    // act
    const instance = await manager.loadPlugin(manifest);

    // assert
    expect(document.body.contains(iframe)).toBe(true);
    expect(instance.id).toBe(manifest.id);
    expect(instance.manifest).toBe(manifest);
    expect(instance.state).toBe('loading');
  });

  it('should throw and keep the existing instance unchanged when loading the same id twice', async () => {
    // arrange
    const { manager } = setupManager();
    const manifest = makeManifest();
    const original = await manager.loadPlugin(manifest);

    // act + assert
    await expect(manager.loadPlugin(manifest)).rejects.toThrow(/already loaded/);
    expect(manager.getPlugin(manifest.id)).toBe(original);
  });

  it('should throw and not pollute plugins map when entry URL is invalid', async () => {
    // arrange
    const { manager } = setupManager();
    const manifest = makeManifest({ id: 'bad', entry: 'http://[::bad' });

    // act + assert
    await expect(manager.loadPlugin(manifest)).rejects.toThrow(/invalid entry/);
    expect(manager.getPlugin('bad')).toBeUndefined();
  });
});

describe('PluginManager.findBySource', () => {
  it('should return the matching instance when source equals the iframe contentWindow and undefined otherwise', async () => {
    // arrange
    const { manager, iframe } = setupManager();
    const instance = await manager.loadPlugin(makeManifest());
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
  it('should set state to ready, start heartbeat once and emit plugin:ready when called for an existing plugin', async () => {
    // arrange
    const { manager, bus, heartbeat } = setupManager();
    const startSpy = vi.spyOn(heartbeat, 'start');
    const readyHandler = vi.fn();
    bus.on('plugin:ready', readyHandler);
    const instance = await manager.loadPlugin(makeManifest());

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
  it('should remove iframe, drop the plugin, stop heartbeat, and emit plugin:unloaded', async () => {
    // arrange
    const { manager, bus, heartbeat, iframe } = setupManager();
    const stopSpy = vi.spyOn(heartbeat, 'stop');
    const unloadedHandler = vi.fn();
    bus.on('plugin:unloaded', unloadedHandler);
    const instance = await manager.loadPlugin(makeManifest());

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
  it('should mark plugin as error and emit plugin:error when EventBus emits plugin:crashed for a known plugin', async () => {
    // arrange
    const { manager, bus } = setupManager();
    const errorHandler = vi.fn();
    bus.on('plugin:error', errorHandler);
    const instance = await manager.loadPlugin(makeManifest());

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
  it('should toggle iframe display, swap state ready<->hidden, pause/resume heartbeat and emit plugin:visibility on each transition', async () => {
    // arrange
    const { manager, bus, heartbeat, iframe } = setupManager();
    const pauseSpy = vi.spyOn(heartbeat, 'pause');
    const resumeSpy = vi.spyOn(heartbeat, 'resume');
    const visibilityHandler = vi.fn();
    bus.on('plugin:visibility', visibilityHandler);
    const instance = await manager.loadPlugin(makeManifest());
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
  it('should return only instances whose state is ready', async () => {
    // arrange
    const bus = EventBus.getInstance();
    const heartbeat = HeartbeatMonitor.getInstance(bus);
    const layerSystem = LayerSystem.getInstance();
    const queue: HTMLIFrameElement[] = [
      makeStubIframe().iframe,
      makeStubIframe().iframe,
      makeStubIframe().iframe,
    ];
    const manager = new PluginManager({
      eventBus: bus,
      heartbeat,
      layerSystem,
      iframeFactory: () => {
        const next = queue.shift();
        if (!next) throw new Error('test setup: iframe queue exhausted');
        return next;
      },
    });
    const a = await manager.loadPlugin(makeManifest({ id: 'a' }));
    const b = await manager.loadPlugin(makeManifest({ id: 'b' }));
    await manager.loadPlugin(makeManifest({ id: 'c' }));
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
  it('should unload all plugins and unsubscribe the crash listener so later plugin:crashed events do not affect remaining plugins', async () => {
    // arrange
    const { manager, bus } = setupManager();
    const survivorStub = makeStubIframe();
    const heartbeat2 = HeartbeatMonitor.getInstance(bus);
    const layerSystem = LayerSystem.getInstance();
    const survivorManager = new PluginManager({
      eventBus: bus,
      heartbeat: heartbeat2,
      layerSystem,
      iframeFactory: () => survivorStub.iframe,
    });
    const survivor = await survivorManager.loadPlugin(makeManifest({ id: 'survivor' }));
    const a = await manager.loadPlugin(makeManifest({ id: 'a' }));

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
  it('should construct a working instance using document.body, default EventBus, HeartbeatMonitor and iframe factory when no opts are provided', async () => {
    // arrange
    const manager = PluginManager.getInstance();

    // act
    const instance = await manager.loadPlugin(makeManifest({ id: 'defaults' }));

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
  it('should be a silent no-op when iframe.contentWindow is null', async () => {
    // arrange
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentWindow', {
      value: null,
      configurable: true,
    });
    const bus = EventBus.getInstance();
    const heartbeat = HeartbeatMonitor.getInstance(bus);
    const layerSystem = LayerSystem.getInstance();
    const manager = new PluginManager({
      eventBus: bus,
      heartbeat,
      layerSystem,
      iframeFactory: () => iframe,
    });
    const instance = await manager.loadPlugin(makeManifest());

    // act + assert
    expect(() => instance.postMessage({ type: 'reui:hello' })).not.toThrow();
  });

  it('should respect an explicit targetOrigin override when provided', async () => {
    // arrange
    const { manager, postMessage } = setupManager();
    const instance = await manager.loadPlugin(makeManifest());

    // act
    instance.postMessage({ type: 'reui:hello' }, '*');

    // assert
    expect(postMessage).toHaveBeenCalledWith({ type: 'reui:hello' }, '*');
  });
});

describe('PluginInstance.postMessage', () => {
  it('should forward the message to iframe.contentWindow.postMessage exactly once with the manifest origin as default targetOrigin', async () => {
    // arrange
    const { manager, postMessage } = setupManager();
    const instance = await manager.loadPlugin(makeManifest());
    const payload = { type: 'reui:hello' };

    // act
    instance.postMessage(payload);

    // assert
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(payload, 'https://plugin.example');
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Stage A2 新增：LayerSystem 集成 / activatePanel / overlay /
//  manifestValidator / state / error
// ─────────────────────────────────────────────────────────────────────────

describe('PluginManager.layer integration', () => {
  it('should mount HUD plugin to HUD layer when loadPlugin succeeds', async () => {
    // arrange
    const { manager, layerSystem, iframe } = setupManager();

    // act
    await manager.loadPlugin(makeManifest({ id: 'hud-x', layer: 'hud' }));

    // assert
    expect(iframe.parentElement).toBe(layerSystem.getLayerContainer('hud'));
  });

  it('should mount Panel plugin to Panel layer with display:none initially', async () => {
    // arrange
    const { manager, layerSystem, iframe } = setupManager();

    // act
    await manager.loadPlugin(makeManifest({ id: 'panel-x', layer: 'panel' }));

    // assert
    expect(iframe.parentElement).toBe(layerSystem.getLayerContainer('panel'));
    expect(iframe.style.display).toBe('none');
  });

  it('should reject loading when manifest.layer === "system"', async () => {
    // arrange
    const { manager } = setupManager();

    // act + assert
    await expect(
      manager.loadPlugin(makeManifest({ id: 'sys-x', layer: 'system' })),
    ).rejects.toThrow(/system layer/);
    expect(manager.getPlugin('sys-x')).toBeUndefined();
  });

  it('should detach iframe via LayerSystem on unloadPlugin', async () => {
    // arrange
    const { manager, iframe } = setupManager();
    const instance = await manager.loadPlugin(makeManifest());

    // act
    manager.unloadPlugin(instance.id);

    // assert
    expect(iframe.parentElement).toBeNull();
  });
});

describe('PluginManager.activatePanel', () => {
  it('should call setActivePanel and mark ready when activatePanel is invoked on a previously hidden panel plugin', async () => {
    // arrange
    const { manager, layerSystem, iframe } = setupManager();
    const setActiveSpy = vi.spyOn(layerSystem, 'setActivePanel');
    const instance = await manager.loadPlugin(
      makeManifest({ id: 'panel-x', layer: 'panel' }),
    );
    manager.markReady(instance.id);
    manager.hidePlugin(instance.id);
    setActiveSpy.mockClear();

    // act
    manager.activatePanel(instance.id);

    // assert
    expect(setActiveSpy).toHaveBeenCalledWith(iframe);
    expect(instance.state).toBe('ready');
  });

  it('should throw when activatePanel is called on a HUD plugin', async () => {
    // arrange
    const { manager } = setupManager();
    const instance = await manager.loadPlugin(makeManifest({ id: 'hud-x', layer: 'hud' }));

    // act + assert
    expect(() => manager.activatePanel(instance.id)).toThrow(/non-panel/);
  });

  it('should throw PluginManagerError PLUGIN_NOT_FOUND when activatePanel is called on an unknown id', () => {
    // arrange
    const { manager } = setupManager();

    // act + assert
    expect(() => manager.activatePanel('ghost')).toThrow(PluginManagerError);
  });
});

describe('PluginManager.overlay', () => {
  it('should push overlay iframe on showPlugin when layer is overlay', async () => {
    // arrange
    const { manager, layerSystem, iframe } = setupManager();
    const pushSpy = vi.spyOn(layerSystem, 'pushOverlay');
    const instance = await manager.loadPlugin(
      makeManifest({ id: 'ov-x', layer: 'overlay' }),
    );
    manager.markReady(instance.id);

    // act
    manager.showPlugin(instance.id);

    // assert
    expect(pushSpy).toHaveBeenCalledWith(iframe);
  });

  it('should pop overlay iframe on hidePlugin when layer is overlay', async () => {
    // arrange
    const { manager, layerSystem, iframe } = setupManager();
    const popSpy = vi.spyOn(layerSystem, 'popOverlay');
    const instance = await manager.loadPlugin(
      makeManifest({ id: 'ov-x', layer: 'overlay' }),
    );
    manager.markReady(instance.id);
    manager.showPlugin(instance.id);

    // act
    manager.hidePlugin(instance.id);

    // assert
    expect(popSpy).toHaveBeenCalledWith(iframe);
  });

  it('should clear all overlays when closeAllOverlays is called', () => {
    // arrange
    const { manager, layerSystem } = setupManager();
    const clearSpy = vi.spyOn(layerSystem, 'clearOverlays');

    // act
    manager.closeAllOverlays();

    // assert
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});

describe('PluginManager.manifestValidator', () => {
  it('should not create iframe when validator throws synchronously', async () => {
    // arrange
    const validator: ManifestValidator = {
      validate: () => {
        throw new Error('schema invalid');
      },
    };
    const { manager, layerSystem } = setupManager({ manifestValidator: validator });
    const hudChildrenBefore = layerSystem.getLayerContainer('hud').children.length;

    // act + assert
    await expect(manager.loadPlugin(makeManifest())).rejects.toThrow(/schema invalid/);
    expect(manager.getPlugin('plugin-a')).toBeUndefined();
    expect(layerSystem.getLayerContainer('hud').children.length).toBe(
      hudChildrenBefore,
    );
  });

  it('should await async validator before mounting the iframe', async () => {
    // arrange
    let resolveValidator: () => void = () => {};
    const validatorPromise = new Promise<void>((res) => {
      resolveValidator = res;
    });
    const validator: ManifestValidator = {
      validate: () => validatorPromise,
    };
    const { manager, iframe } = setupManager({ manifestValidator: validator });

    // act
    const loadPromise = manager.loadPlugin(makeManifest());
    // 在 validator resolve 前，iframe 不应被挂载。
    expect(iframe.parentElement).toBeNull();
    resolveValidator();
    await vi.advanceTimersByTimeAsync(0);
    const instance = await loadPromise;

    // assert
    expect(instance.id).toBe('plugin-a');
    expect(iframe.parentElement).not.toBeNull();
  });
});

describe('PluginManager.state', () => {
  it('should round-trip JSON-able payload via saveState / loadState', async () => {
    // arrange
    const { manager } = setupManager();
    await manager.loadPlugin(makeManifest());
    const payload = { theme: 'dark', position: { x: 1, y: 2 } };

    // act
    manager.saveState('plugin-a', payload);

    // assert
    expect(manager.loadState('plugin-a')).toEqual(payload);
  });

  it('should throw PLUGIN_NOT_FOUND when saveState is called on an unknown plugin', () => {
    // arrange
    const { manager } = setupManager();

    // act + assert
    let caught: unknown;
    try {
      manager.saveState('ghost', { any: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PluginManagerError);
    expect((caught as PluginManagerError).code).toBe('PLUGIN_NOT_FOUND');
  });

  it('should return undefined when loadState is called on an unknown plugin', () => {
    // arrange
    const { manager } = setupManager();

    // act
    const result = manager.loadState('ghost');

    // assert
    expect(result).toBeUndefined();
  });

  it('should throw PAYLOAD_TOO_LARGE when payload size exceeds 1MB', async () => {
    // arrange
    const { manager } = setupManager();
    await manager.loadPlugin(makeManifest());
    // ~1.1MB string when JSON-serialized.
    const huge = { blob: 'x'.repeat(1.1 * 1024 * 1024) };

    // act + assert
    let caught: unknown;
    try {
      manager.saveState('plugin-a', huge);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PluginManagerError);
    expect((caught as PluginManagerError).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('should keep state across unloadPlugin and re-loadPlugin', async () => {
    // arrange
    const stub2 = makeStubIframe();
    const queue: HTMLIFrameElement[] = [makeStubIframe().iframe, stub2.iframe];
    const bus = EventBus.getInstance();
    const heartbeat = HeartbeatMonitor.getInstance(bus);
    const layerSystem = LayerSystem.getInstance();
    const manager = new PluginManager({
      eventBus: bus,
      heartbeat,
      layerSystem,
      iframeFactory: () => {
        const next = queue.shift();
        if (!next) throw new Error('test setup: iframe queue exhausted');
        return next;
      },
    });
    await manager.loadPlugin(makeManifest());
    manager.saveState('plugin-a', { kept: true });

    // act
    manager.unloadPlugin('plugin-a');
    await manager.loadPlugin(makeManifest());

    // assert
    expect(manager.loadState('plugin-a')).toEqual({ kept: true });
  });

  it('should clear state when clearState is called', async () => {
    // arrange
    const { manager } = setupManager();
    await manager.loadPlugin(makeManifest());
    manager.saveState('plugin-a', { keep: 1 });

    // act
    manager.clearState('plugin-a');

    // assert
    expect(manager.loadState('plugin-a')).toBeUndefined();
  });
});

describe('PluginManager.error', () => {
  it('should expose PluginManagerError with a code field carrying the error code', () => {
    // arrange
    const err = new PluginManagerError('PAYLOAD_TOO_LARGE', 'too big');

    // act + assert
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PluginManagerError');
    expect(err.code).toBe('PAYLOAD_TOO_LARGE');
    expect(err.message).toBe('too big');
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Stage A2.3 新增：默认 sessionStorage 落地实现 + 异常降级
// ─────────────────────────────────────────────────────────────────────────

describe('PluginManager default sessionStorage state storage', () => {
  it('should write state to window.sessionStorage with the reui:plugin-state: prefix when no custom storage is injected', async () => {
    // arrange
    const stub = makeStubIframe();
    const manager = new PluginManager({
      iframeFactory: () => stub.iframe,
    });
    await manager.loadPlugin(makeManifest());

    // act
    manager.saveState('plugin-a', { hello: 'world' });

    // assert
    const raw = window.sessionStorage.getItem('reui:plugin-state:plugin-a');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ hello: 'world' });
  });

  it('should round-trip via the default sessionStorage backend', async () => {
    // arrange
    const stub = makeStubIframe();
    const manager = new PluginManager({
      iframeFactory: () => stub.iframe,
    });
    await manager.loadPlugin(makeManifest());

    // act
    manager.saveState('plugin-a', { x: 1, nested: { y: 2 } });

    // assert
    expect(manager.loadState('plugin-a')).toEqual({ x: 1, nested: { y: 2 } });
  });

  it('should remove the key from sessionStorage when clearState is called', async () => {
    // arrange
    const stub = makeStubIframe();
    const manager = new PluginManager({
      iframeFactory: () => stub.iframe,
    });
    await manager.loadPlugin(makeManifest());
    manager.saveState('plugin-a', { keep: 1 });

    // act
    manager.clearState('plugin-a');

    // assert
    expect(window.sessionStorage.getItem('reui:plugin-state:plugin-a')).toBeNull();
    expect(manager.loadState('plugin-a')).toBeUndefined();
  });

  it('should return undefined from loadState when sessionStorage entry is corrupted JSON', async () => {
    // arrange
    const stub = makeStubIframe();
    const manager = new PluginManager({
      iframeFactory: () => stub.iframe,
    });
    await manager.loadPlugin(makeManifest());
    // 直接污染 sessionStorage 模拟外部破坏。
    window.sessionStorage.setItem('reui:plugin-state:plugin-a', '{not json');

    // act
    const result = manager.loadState('plugin-a');

    // assert
    expect(result).toBeUndefined();
  });

  it('should clear only reui:plugin-state: keys from sessionStorage on __resetForTests, leaving foreign keys intact', async () => {
    // arrange
    const stub = makeStubIframe();
    const manager = new PluginManager({
      iframeFactory: () => stub.iframe,
    });
    await manager.loadPlugin(makeManifest());
    manager.saveState('plugin-a', { v: 1 });
    window.sessionStorage.setItem('foreign-key', 'keep-me');

    // act
    PluginManager.__resetForTests();

    // assert
    expect(window.sessionStorage.getItem('reui:plugin-state:plugin-a')).toBeNull();
    expect(window.sessionStorage.getItem('foreign-key')).toBe('keep-me');
    // cleanup so后续 afterEach 不被这条测试加入的外部 key 干扰
    window.sessionStorage.removeItem('foreign-key');
  });
});
