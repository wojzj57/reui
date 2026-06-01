/**
 * Stage A1 minimal PluginManager. LayerSystem mounting, signature verification,
 * Panel mutex, and saveState/restoreState are deferred to Stage A2.
 *
 * 职责（仅本阶段）：
 *   - 创建/销毁插件 iframe（含计算 origin 与挂到 container）；
 *   - 维护 pluginId -> PluginInstance Map，提供 findBySource 给 MessageDispatcher；
 *   - 暴露 markReady / markCrashed 让 PostMessageRouter / HeartbeatMonitor 驱动状态；
 *   - 订阅 EventBus 'plugin:crashed' 自动 markCrashed；
 *   - show/hide 切换 display 与 heartbeat pause/resume。
 *
 * 关键约定：
 *   1. 不引入 LayerSystem，layer 只通过 `iframe.dataset.layer` 暴露给后续接管；
 *   2. 不在模块顶层挂任何全局 message 监听；MessageDispatcher 通过 findBySource
 *      反查 PluginInstance；
 *   3. 类型严格——禁 any；事件 payload 用 unknown + type guard；
 *   4. 待 RFC-002 §4.1 的 plugin manifest schema 统一后，PluginManifestMinimal
 *      将由 @reui/cli 真相源替换。
 */

import { EventBus } from './event-bus';
import { HeartbeatMonitor } from './heartbeat-monitor';

export type PluginState = 'loading' | 'ready' | 'hidden' | 'error';

export interface PluginManifestMinimal {
  id: string;
  /** iframe src */
  entry: string;
  layer: 'hud' | 'panel' | 'overlay' | 'system';
  permissions?: string[];
}

export interface PluginInstance {
  readonly id: string;
  readonly manifest: PluginManifestMinimal;
  readonly iframe: HTMLIFrameElement;
  readonly origin: string;
  state: PluginState;
  postMessage(msg: unknown, targetOrigin?: string): void;
}

export interface PluginManagerOptions {
  /** 默认 document.body */
  container?: HTMLElement;
  /** 默认 EventBus.getInstance() */
  eventBus?: EventBus;
  /** 默认 HeartbeatMonitor.getInstance() */
  heartbeat?: HeartbeatMonitor;
  /** 测试用：自定义 iframe 工厂以便注入 stub contentWindow */
  iframeFactory?: (manifest: PluginManifestMinimal) => HTMLIFrameElement;
}

const defaultIframeFactory = (manifest: PluginManifestMinimal): HTMLIFrameElement => {
  const f = document.createElement('iframe');
  f.src = manifest.entry;
  f.dataset.pluginId = manifest.id;
  f.dataset.layer = manifest.layer;
  return f;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export class PluginManager {
  private static _instance: PluginManager | null = null;

  private readonly plugins = new Map<string, PluginInstance>();
  private readonly container: HTMLElement;
  private readonly eventBus: EventBus;
  private readonly heartbeat: HeartbeatMonitor;
  private readonly iframeFactory: (manifest: PluginManifestMinimal) => HTMLIFrameElement;
  private readonly crashUnsubscribe: () => void;

  constructor(opts: PluginManagerOptions = {}) {
    this.container = opts.container ?? document.body;
    this.eventBus = opts.eventBus ?? EventBus.getInstance();
    this.heartbeat = opts.heartbeat ?? HeartbeatMonitor.getInstance();
    this.iframeFactory = opts.iframeFactory ?? defaultIframeFactory;

    this.crashUnsubscribe = this.eventBus.on('plugin:crashed', (payload) => {
      if (isRecord(payload) && 'pluginId' in payload) {
        this.markCrashed(String(payload.pluginId), 'heartbeat-timeout');
      }
    });
  }

  /**
   * 单例入口。第二次及以后调用时若再传 opts 将被忽略——
   * 单例的依赖在首次构造时已绑定。
   */
  static getInstance(opts?: PluginManagerOptions): PluginManager {
    if (!PluginManager._instance) {
      PluginManager._instance = new PluginManager(opts);
    }
    return PluginManager._instance;
  }

  /** 仅测试使用：重置单例避免用例间状态泄漏。 */
  static __resetForTests(): void {
    if (PluginManager._instance) {
      PluginManager._instance.dispose();
    }
    PluginManager._instance = null;
  }

  // ── 公开 API ─────────────────────────────────────────────────────────

  loadPlugin(manifest: PluginManifestMinimal): PluginInstance {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`PluginManager: plugin '${manifest.id}' already loaded`);
    }

    // 计算 origin——entry 非法直接抛错，避免被半成品 instance 污染 plugins。
    let origin: string;
    try {
      origin = new URL(manifest.entry, location.href).origin;
    } catch {
      throw new Error(`PluginManager: invalid entry URL '${manifest.entry}'`);
    }

    const iframe = this.iframeFactory(manifest);
    this.container.appendChild(iframe);

    const instance: PluginInstance = {
      id: manifest.id,
      manifest,
      iframe,
      origin,
      state: 'loading',
      postMessage(msg: unknown, targetOrigin?: string): void {
        const win = iframe.contentWindow;
        if (!win) return;
        win.postMessage(msg, targetOrigin ?? origin);
      },
    };

    this.plugins.set(manifest.id, instance);
    // 心跳由 markReady 在握手成功后启动——此处只做加载，不监控。
    return instance;
  }

  unloadPlugin(pluginId: string): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;
    this.heartbeat.stop(pluginId);
    instance.iframe.remove();
    this.plugins.delete(pluginId);
    this.eventBus.emit('plugin:unloaded', { pluginId });
  }

  findBySource(source: MessageEventSource | null): PluginInstance | undefined {
    if (source === null) return undefined;
    for (const instance of this.plugins.values()) {
      if (instance.iframe.contentWindow === source) return instance;
    }
    return undefined;
  }

  markReady(pluginId: string): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;
    instance.state = 'ready';
    this.heartbeat.start({
      pluginId,
      postMessage: (msg) => instance.postMessage(msg),
    });
    this.eventBus.emit('plugin:ready', { pluginId });
  }

  markCrashed(pluginId: string, reason: string): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;
    instance.state = 'error';
    // 防御：HeartbeatMonitor 在 handleCrash 时已 stop，但外部直接调
    // markCrashed 时仍需清理可能残留的 interval。
    this.heartbeat.stop(pluginId);
    this.eventBus.emit('plugin:error', { pluginId, reason });
  }

  showPlugin(pluginId: string): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;
    instance.iframe.style.display = '';
    if (instance.state === 'hidden') {
      instance.state = 'ready';
    }
    this.heartbeat.resume(pluginId);
    this.eventBus.emit('plugin:visibility', { pluginId, visible: true });
  }

  hidePlugin(pluginId: string): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;
    instance.iframe.style.display = 'none';
    if (instance.state === 'ready') {
      instance.state = 'hidden';
    }
    this.heartbeat.pause(pluginId);
    this.eventBus.emit('plugin:visibility', { pluginId, visible: false });
  }

  getPlugin(id: string): PluginInstance | undefined {
    return this.plugins.get(id);
  }

  getActivePlugins(): PluginInstance[] {
    const out: PluginInstance[] = [];
    for (const instance of this.plugins.values()) {
      if (instance.state === 'ready') out.push(instance);
    }
    return out;
  }

  dispose(): void {
    for (const id of [...this.plugins.keys()]) {
      this.unloadPlugin(id);
    }
    this.crashUnsubscribe();
  }
}
