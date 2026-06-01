/**
 * Stage A2 PluginManager。在 Stage A1 极简版的基础上接入：
 *   1. LayerSystem（HUD/Panel/Overlay 挂载，'system' 拒绝）；
 *   2. Panel 单插件互斥（activatePanel）+ Overlay 栈式管理；
 *   3. ManifestValidator 注入点（同步/异步均可，抛错即视为加载失败）；
 *   4. saveState / loadState / clearState（默认 in-memory，1MB 上限）；
 *   5. 错误码用 PluginManagerError（PAYLOAD_TOO_LARGE / PLUGIN_NOT_FOUND）。
 *
 * 关键约定：
 *   - LayerSystem 是 DOM 真相源——不再调 container.appendChild；
 *   - 插件 iframe 的 display 切换分流：HUD 走 iframe.style.display；
 *     Panel 走 setActivePanel；Overlay 走 push/popOverlay；
 *   - state 与 plugin 生命周期解耦：unloadPlugin 不清 state，方便 reload 后恢复；
 *   - 类型严格——禁 any；事件 payload 用 unknown + type guard；
 *   - 单例 dispose 不动 LayerSystem——LayerSystem 自己 __resetForTests 管。
 */

import { EventBus } from './event-bus';
import { HeartbeatMonitor } from './heartbeat-monitor';
import { LayerSystem } from './layer-system';

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

export interface ManifestValidator {
  /** 抛错则视为校验失败；返回值忽略。 */
  validate(manifest: PluginManifestMinimal): void | Promise<void>;
}

export interface PluginStateStorage {
  get(pluginId: string): unknown;
  set(pluginId: string, payload: unknown): void;
  delete(pluginId: string): void;
}

export interface PluginManagerOptions {
  /** 默认 document.body；layer 模式下 LayerSystem 会接管挂载点。 */
  container?: HTMLElement;
  /** 默认 EventBus.getInstance() */
  eventBus?: EventBus;
  /** 默认 HeartbeatMonitor.getInstance() */
  heartbeat?: HeartbeatMonitor;
  /** 测试用：自定义 iframe 工厂以便注入 stub contentWindow */
  iframeFactory?: (manifest: PluginManifestMinimal) => HTMLIFrameElement;
  /** 默认 LayerSystem.getInstance() */
  layerSystem?: LayerSystem;
  /** 可选；为 null/undefined 时不校验 */
  manifestValidator?: ManifestValidator;
  /**
   * 落地存储引擎。默认优先使用 window.sessionStorage（生产默认）；
   * 当 sessionStorage 不可用（jsdom opaque origin / SSR / 隐私模式）时
   * 自动降级到 in-memory Map。生产环境如需更长生命周期可注入 IndexedDB 实现。
   */
  stateStorage?: PluginStateStorage;
}

export type PluginManagerErrorCode = 'PAYLOAD_TOO_LARGE' | 'PLUGIN_NOT_FOUND';

export class PluginManagerError extends Error {
  readonly code: PluginManagerErrorCode;
  constructor(code: PluginManagerErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PluginManagerError';
  }
}

/** Fallback in-memory 存储——用在 sessionStorage 不可用（如 opaque origin / SSR）的环境。 */
class InMemoryStateStorage implements PluginStateStorage {
  private readonly map = new Map<string, unknown>();
  get(pluginId: string): unknown {
    return this.map.get(pluginId);
  }
  set(pluginId: string, payload: unknown): void {
    this.map.set(pluginId, payload);
  }
  delete(pluginId: string): void {
    this.map.delete(pluginId);
  }
}

/**
 * 生产默认：sessionStorage 实现。
 * 命名空间前缀 `reui:plugin-state:` 防与宿主页面其他 key 冲突。
 * payload 在 saveState 处已按字节做过 1MB 校验——这里的 setItem
 * 仍可能因浏览器配额而抛 QuotaExceededError，由调用方按原样冒出。
 */
class SessionStorageStateStorage implements PluginStateStorage {
  private static readonly PREFIX = 'reui:plugin-state:';
  constructor(private readonly storage: Storage) {}
  private key(pluginId: string): string {
    return `${SessionStorageStateStorage.PREFIX}${pluginId}`;
  }
  get(pluginId: string): unknown {
    const raw = this.storage.getItem(this.key(pluginId));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      // 损坏的 payload 当作不存在；不抛错避免污染 loadState 的语义。
      return undefined;
    }
  }
  set(pluginId: string, payload: unknown): void {
    this.storage.setItem(this.key(pluginId), JSON.stringify(payload));
  }
  delete(pluginId: string): void {
    this.storage.removeItem(this.key(pluginId));
  }
}

/**
 * 嗅探 sessionStorage 是否可用：
 *   - 非浏览器/无 window 环境直接 false
 *   - jsdom 的 opaque origin 访问 sessionStorage 会抛 SecurityError
 *   - 隐私模式 / 某些容器场景 setItem 会抛 QuotaExceededError
 * 任一失败都退化到 InMemoryStateStorage。
 */
const createDefaultStateStorage = (): PluginStateStorage => {
  try {
    if (typeof window === 'undefined') return new InMemoryStateStorage();
    const probe = window.sessionStorage;
    const probeKey = '__reui_probe__';
    probe.setItem(probeKey, '1');
    probe.removeItem(probeKey);
    return new SessionStorageStateStorage(probe);
  } catch {
    return new InMemoryStateStorage();
  }
};

const MAX_STATE_PAYLOAD_BYTES = 1024 * 1024;

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
  private readonly layerSystem: LayerSystem;
  private readonly manifestValidator: ManifestValidator | null;
  private readonly stateStorage: PluginStateStorage;
  private readonly crashUnsubscribe: () => void;

  constructor(opts: PluginManagerOptions = {}) {
    this.container = opts.container ?? document.body;
    this.eventBus = opts.eventBus ?? EventBus.getInstance();
    this.heartbeat = opts.heartbeat ?? HeartbeatMonitor.getInstance();
    this.iframeFactory = opts.iframeFactory ?? defaultIframeFactory;
    this.layerSystem = opts.layerSystem ?? LayerSystem.getInstance();
    this.manifestValidator = opts.manifestValidator ?? null;
    this.stateStorage = opts.stateStorage ?? createDefaultStateStorage();

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

  /**
   * 仅测试使用：重置单例避免用例间状态泄漏。
   * 同时清空 sessionStorage 中带本组件前缀的所有 key——saveState
   * 在生产环境会跨 plugin 生命周期保留，但跨用例必须清干净，
   * 否则 `restoreState` 类用例会被前一条用例的写入污染。
   */
  static __resetForTests(): void {
    if (PluginManager._instance) {
      PluginManager._instance.dispose();
    }
    PluginManager._instance = null;
    if (typeof window !== 'undefined') {
      try {
        const s = window.sessionStorage;
        const toRemove: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k !== null && k.startsWith('reui:plugin-state:')) toRemove.push(k);
        }
        for (const k of toRemove) s.removeItem(k);
      } catch {
        // sessionStorage 不可用——in-memory fallback，无需清。
      }
    }
  }

  // ── 公开 API ─────────────────────────────────────────────────────────

  async loadPlugin(manifest: PluginManifestMinimal): Promise<PluginInstance> {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`PluginManager: plugin '${manifest.id}' already loaded`);
    }

    if (manifest.layer === 'system') {
      throw new Error('PluginManager: plugins cannot mount on system layer');
    }

    // 计算 origin——entry 非法直接抛错，避免被半成品 instance 污染 plugins。
    let origin: string;
    try {
      origin = new URL(manifest.entry, location.href).origin;
    } catch {
      throw new Error(`PluginManager: invalid entry URL '${manifest.entry}'`);
    }

    // ManifestValidator：抛错则视为加载失败，**不创建 iframe、不进 plugins map**。
    if (this.manifestValidator) {
      await this.manifestValidator.validate(manifest);
    }

    const iframe = this.iframeFactory(manifest);
    // 通过 LayerSystem 挂载（panel/overlay 默认 display:none）。
    this.layerSystem.attachToLayer(iframe, manifest.layer);

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
    this.layerSystem.detachFromLayer(instance.iframe);
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
    this.applyVisibility(instance, true);
  }

  hidePlugin(pluginId: string): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;
    this.applyVisibility(instance, false);
  }

  /** Panel 互斥激活。非 panel 抛错。 */
  activatePanel(pluginId: string): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new PluginManagerError(
        'PLUGIN_NOT_FOUND',
        `PluginManager: plugin '${pluginId}' is not loaded`,
      );
    }
    if (instance.manifest.layer !== 'panel') {
      throw new Error(
        `PluginManager: activatePanel called on non-panel plugin '${pluginId}' (layer='${instance.manifest.layer}')`,
      );
    }
    this.layerSystem.setActivePanel(instance.iframe);
    if (instance.state === 'hidden') {
      instance.state = 'ready';
    }
    this.heartbeat.resume(pluginId);
    this.eventBus.emit('plugin:visibility', { pluginId, visible: true });
  }

  /** 关闭所有 overlay。 */
  closeAllOverlays(): void {
    this.layerSystem.clearOverlays();
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

  // ── state 持久化 ────────────────────────────────────────────────────

  saveState(pluginId: string, payload: unknown): void {
    if (!this.plugins.has(pluginId)) {
      throw new PluginManagerError(
        'PLUGIN_NOT_FOUND',
        `PluginManager: plugin '${pluginId}' is not loaded`,
      );
    }
    const serialized = JSON.stringify(payload);
    // jsdom 中 Blob 可用——用它精确测算 utf-8 字节数。
    const size = new Blob([serialized]).size;
    if (size > MAX_STATE_PAYLOAD_BYTES) {
      throw new PluginManagerError(
        'PAYLOAD_TOO_LARGE',
        `PluginManager: saveState payload for '${pluginId}' is ${size} bytes, exceeds ${MAX_STATE_PAYLOAD_BYTES}`,
      );
    }
    this.stateStorage.set(pluginId, payload);
  }

  loadState(pluginId: string): unknown {
    return this.stateStorage.get(pluginId);
  }

  clearState(pluginId: string): void {
    this.stateStorage.delete(pluginId);
  }

  dispose(): void {
    for (const id of [...this.plugins.keys()]) {
      this.unloadPlugin(id);
    }
    this.crashUnsubscribe();
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  private applyVisibility(instance: PluginInstance, visible: boolean): void {
    const layer = instance.manifest.layer;
    if (layer === 'hud') {
      instance.iframe.style.display = visible ? '' : 'none';
    } else if (layer === 'panel') {
      if (visible) {
        // show 等价于 activatePanel——但避免重复发事件，这里直接走 LayerSystem。
        this.layerSystem.setActivePanel(instance.iframe);
      } else {
        // 仅在当前激活的就是它时撤销整个 panel 层；否则只藏自己 iframe。
        if (this.isActivePanel(instance)) {
          this.layerSystem.setActivePanel(null);
        } else {
          instance.iframe.style.display = 'none';
        }
      }
    } else if (layer === 'overlay') {
      if (visible) {
        this.layerSystem.pushOverlay(instance.iframe);
      } else {
        this.layerSystem.popOverlay(instance.iframe);
      }
    }

    // 状态机：ready ↔ hidden。
    if (visible) {
      if (instance.state === 'hidden') instance.state = 'ready';
      this.heartbeat.resume(instance.id);
    } else {
      if (instance.state === 'ready') instance.state = 'hidden';
      this.heartbeat.pause(instance.id);
    }

    this.eventBus.emit('plugin:visibility', {
      pluginId: instance.id,
      visible,
    });
  }

  private isActivePanel(instance: PluginInstance): boolean {
    const panelDiv = this.layerSystem.getLayerContainer('panel');
    // 当前可见（display 非 none）的 panel iframe 视为 active。
    for (const child of Array.from(panelDiv.children)) {
      const el = child as HTMLElement;
      if (el === instance.iframe && el.style.display !== 'none') return true;
    }
    return false;
  }
}
