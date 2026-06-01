/**
 * MessageDispatcher（RFC-001 §3.2）。
 *
 * Runtime 是整个体系**唯一**的 `window.addEventListener('message', ...)`
 * 持有者；本类承担来源鉴别与分流：
 *
 *   1. `event.source === null` 或 `event.source === window`
 *      → 视为 NUI 游戏端，转交 `nuiBridge.handleGameMessage(event.data)`；
 *   2. `event.source` 命中 `pluginManager.findBySource(...)` 返回的插件
 *      → 进入 iframe 分支，再校验 `event.data` 是 `{ type: string }` 且
 *        `type` 以 `'reui:'` 开头，最后转交 `router.handlePluginMessage(plugin, data)`；
 *   3. 其它情况静默丢弃（DEV 下打印 warn）。
 *
 * 关键约定：
 *   - 任何分支抛出的异常都不向 window 全局冒泡；同时把异常 emit 到 EventBus
 *     的 `dispatcher:error`，方便后续观测；
 *   - 单例 + 依赖注入：构造函数允许注入 PluginManager / NuiBridge / Router /
 *     EventBus / Window，便于测试与未来 Router 真身就位时的替换。
 *   - Router 默认 undefined。未配置时 iframe 分支静默丢弃 + DEV warn，方便在
 *     PostMessageRouter 真身就位前先拉起 dispatcher 不抛错。
 */

import { EventBus } from './event-bus';
import { NuiBridge } from './nui-bridge';
import { PluginManager, type PluginInstance } from './plugin-manager';

/** Router 的最小接口契约——由 PostMessageRouter 真身实现并通过 setRouter 注入。 */
export interface MessageDispatcherRouterLike {
  handlePluginMessage(plugin: PluginInstance, data: unknown): void;
}

export interface MessageDispatcherOptions {
  pluginManager?: PluginManager;
  nuiBridge?: NuiBridge;
  router?: MessageDispatcherRouterLike;
  eventBus?: EventBus;
  /** 默认 globalThis.window；测试用 jsdom window 注入。 */
  window?: Window;
}

type MessageHandler = (event: MessageEvent) => void;

export class MessageDispatcher {
  private static _instance: MessageDispatcher | null = null;

  private readonly pluginManager: PluginManager;
  private readonly nuiBridge: NuiBridge;
  private readonly eventBus: EventBus;
  private readonly window: Window;
  private router: MessageDispatcherRouterLike | undefined;
  private handler: MessageHandler | null = null;

  constructor(opts: MessageDispatcherOptions = {}) {
    this.pluginManager = opts.pluginManager ?? PluginManager.getInstance();
    this.nuiBridge = opts.nuiBridge ?? NuiBridge.getInstance();
    this.eventBus = opts.eventBus ?? EventBus.getInstance();
    const w = opts.window ?? (typeof window !== 'undefined' ? window : undefined);
    if (!w) {
      throw new Error(
        'MessageDispatcher: no window available; pass opts.window in non-DOM env',
      );
    }
    this.window = w;
    this.router = opts.router;
  }

  /**
   * 单例入口。第二次及以后调用时若再传 opts 将被忽略——
   * 单例的依赖在首次构造时已绑定。
   */
  static getInstance(opts?: MessageDispatcherOptions): MessageDispatcher {
    if (!MessageDispatcher._instance) {
      MessageDispatcher._instance = new MessageDispatcher(opts);
    }
    return MessageDispatcher._instance;
  }

  /** 仅测试使用：先 stop 当前实例再清空单例。 */
  static __resetForTests(): void {
    if (MessageDispatcher._instance) {
      MessageDispatcher._instance.stop();
    }
    MessageDispatcher._instance = null;
  }

  // ── 公开 API ─────────────────────────────────────────────────────────

  /**
   * 挂载 message 监听。重复调用幂等：先解绑旧 handler 再挂新的，
   * 保证只有一个监听器。
   */
  start(): void {
    if (this.handler !== null) {
      this.window.removeEventListener('message', this.handler);
      this.handler = null;
    }
    const handler: MessageHandler = (event) => this.dispatch(event);
    this.handler = handler;
    this.window.addEventListener('message', handler);
  }

  /** 解绑监听；可重复调用。 */
  stop(): void {
    if (this.handler === null) return;
    this.window.removeEventListener('message', this.handler);
    this.handler = null;
  }

  isRunning(): boolean {
    return this.handler !== null;
  }

  /** 后续 PostMessageRouter 真身就位时通过此方法注入。 */
  setRouter(router: MessageDispatcherRouterLike): void {
    this.router = router;
  }

  // ── 分发主流程 ───────────────────────────────────────────────────────

  private dispatch(event: MessageEvent): void {
    const source = event.source;

    // 分支 1：NUI 游戏端（source 为 null 或就是当前 window）。
    if (source === null || source === this.window) {
      try {
        this.nuiBridge.handleGameMessage(event.data);
      } catch (err) {
        this.reportError(err, 'nui');
      }
      return;
    }

    // 分支 2：source 必须是已注册的 iframe.contentWindow。
    const plugin = this.pluginManager.findBySource(source);
    if (!plugin) {
      devWarn('MessageDispatcher: dropped message from unknown source');
      return;
    }

    // iframe 分支：data 必须是 { type: 'reui:...' } 形态。
    if (!isReuiEnvelope(event.data)) {
      devWarn(
        `MessageDispatcher: dropped non-reui payload from plugin '${plugin.id}'`,
        event.data,
      );
      return;
    }

    if (!this.router) {
      devWarn(
        `MessageDispatcher: router not configured; dropped reui message from plugin '${plugin.id}'`,
      );
      return;
    }

    try {
      this.router.handlePluginMessage(plugin, event.data);
    } catch (err) {
      this.reportError(err, 'plugin');
    }
  }

  private reportError(
    err: unknown,
    source: 'nui' | 'plugin' | 'unknown',
  ): void {
    // 不再重新 throw——监听器异常一旦冒泡到 window 会触发全局 error 事件。
    try {
      this.eventBus.emit('dispatcher:error', { error: err, source });
    } catch {
      // EventBus 自身已隔离 handler 异常，这里再加一道兜底防御。
    }
  }
}

// ── 类型守卫 / 工具 ──────────────────────────────────────────────────────

const isReuiEnvelope = (d: unknown): d is { type: string } => {
  if (typeof d !== 'object' || d === null) return false;
  if (!('type' in d)) return false;
  const t = (d as { type: unknown }).type;
  return typeof t === 'string' && t.startsWith('reui:');
};

const devWarn = (message: string, ...args: unknown[]): void => {
  if (
    typeof process !== 'undefined' &&
    process.env != null &&
    process.env.NODE_ENV !== 'production'
  ) {
    // eslint-disable-next-line no-console
    console.warn(`[ReUI:MessageDispatcher] ${message}`, ...args);
  }
};
