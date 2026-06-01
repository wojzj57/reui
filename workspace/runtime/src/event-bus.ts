/**
 * EventBus（RFC-003 §3.1）。
 *
 * Runtime 内部的全局事件总线，承载：
 *   - 业务事件（插件之间通过 EventBus 中转，不直接 postMessage）；
 *   - 系统事件（auth / plugin 生命周期等）；
 *   - 通配符订阅（`prefix:*` 与 `*`）。
 *
 * 关键设计点：
 *   1. handler 抛错被隔离（catch + console.error）——单个订阅者不能影响其它；
 *   2. emit 阶段对 listener Set 做"快照"迭代——避免 handler 在回调中
 *      取消订阅 / 添加订阅时影响本轮分发；
 *   3. `subscribeForPlugin` 维护 (pluginId -> handlers) 反向索引，
 *      支持插件卸载时一键清理（RFC-002 §3.4 的资源回收要求）。
 */

export type EventHandler = (payload: unknown) => void;
export type Unsubscribe = () => void;

/** 单个订阅记录——同时维护精确/通配条目以支持反向解绑。 */
interface PluginSubscription {
  event: string;
  handler: EventHandler;
}

export class EventBus {
  private static _instance: EventBus | null = null;

  /** 精确匹配监听器：event -> handlers。 */
  private readonly listeners = new Map<string, Set<EventHandler>>();
  /** 通配符监听器：pattern -> handlers。 */
  private readonly wildcardListeners = new Map<string, Set<EventHandler>>();
  /** 插件订阅追踪：pluginId -> 订阅条目（用于卸载时清理）。 */
  private readonly pluginSubscriptions = new Map<string, Set<PluginSubscription>>();

  static getInstance(): EventBus {
    if (!EventBus._instance) EventBus._instance = new EventBus();
    return EventBus._instance;
  }

  /** 仅测试使用：重置单例避免用例间状态泄漏。 */
  static __resetForTests(): void {
    EventBus._instance = null;
  }

  /**
   * 订阅事件。
   * - `*` 与 `prefix:*` 进入通配符表；
   * - 其它进入精确匹配表。
   */
  on(event: string, handler: EventHandler): Unsubscribe {
    const bucket = this.bucketFor(event);
    let set = bucket.get(event);
    if (!set) {
      set = new Set();
      bucket.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler): void {
    const bucket = this.bucketFor(event);
    const set = bucket.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) bucket.delete(event);
  }

  /** 一次性订阅：触发后自动解绑。 */
  once(event: string, handler: EventHandler): Unsubscribe {
    const wrapper: EventHandler = (payload) => {
      try {
        handler(payload);
      } finally {
        this.off(event, wrapper);
      }
    };
    return this.on(event, wrapper);
  }

  /**
   * 发布事件：先派发精确监听器，再派发通配符。
   * 单个 handler 异常被隔离，不影响其它订阅者。
   */
  emit(event: string, payload: unknown): void {
    // 阶段 1：精确匹配。复制为数组避免迭代过程中的增删扰动。
    const exact = this.listeners.get(event);
    if (exact && exact.size > 0) {
      for (const h of [...exact]) safeInvoke(h, payload, event);
    }

    // 阶段 2：通配符匹配。
    if (this.wildcardListeners.size === 0) return;
    for (const [pattern, set] of this.wildcardListeners) {
      if (!matchPattern(pattern, event)) continue;
      for (const h of [...set]) safeInvoke(h, payload, event);
    }
  }

  /**
   * 为特定插件订阅事件——同时记录到 pluginSubscriptions 用于后续清理。
   * RFC-002 §3.4 要求插件卸载时一次性回收资源。
   */
  subscribeForPlugin(pluginId: string, event: string, handler: EventHandler): Unsubscribe {
    const unsub = this.on(event, handler);
    let set = this.pluginSubscriptions.get(pluginId);
    if (!set) {
      set = new Set();
      this.pluginSubscriptions.set(pluginId, set);
    }
    const entry: PluginSubscription = { event, handler };
    set.add(entry);
    return () => {
      unsub();
      set!.delete(entry);
      if (set!.size === 0) this.pluginSubscriptions.delete(pluginId);
    };
  }

  /** 一次性清理某插件的所有订阅。 */
  unsubscribePlugin(pluginId: string): void {
    const set = this.pluginSubscriptions.get(pluginId);
    if (!set) return;
    for (const { event, handler } of set) this.off(event, handler);
    this.pluginSubscriptions.delete(pluginId);
  }

  /** @internal 仅测试 / 调试。 */
  get exactListenerCount(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }

  /** @internal 仅测试 / 调试。 */
  get wildcardListenerCount(): number {
    let n = 0;
    for (const s of this.wildcardListeners.values()) n += s.size;
    return n;
  }

  /** @internal 仅测试 / 调试。 */
  pluginSubscriptionCount(pluginId: string): number {
    return this.pluginSubscriptions.get(pluginId)?.size ?? 0;
  }

  private bucketFor(event: string): Map<string, Set<EventHandler>> {
    return isWildcard(event) ? this.wildcardListeners : this.listeners;
  }
}

// ── 辅助函数 ───────────────────────────────────────────────────────────────

const isWildcard = (event: string): boolean =>
  event === '*' || event.endsWith(':*');

/**
 * 通配符匹配（RFC-003 §3.1.3）。
 *
 * - `*` 全匹配；
 * - `prefix:*` 匹配以 `prefix:` 开头的事件（不含 `prefix:` 本身——
 *   单独的 `prefix:` 是不合法事件名，不参与匹配）；
 * - 其他模式视为精确名（不应进入此函数）。
 */
const matchPattern = (pattern: string, event: string): boolean => {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // "player:*" -> "player:"
    return event.startsWith(prefix);
  }
  return false;
};

const safeInvoke = (handler: EventHandler, payload: unknown, event: string): void => {
  try {
    handler(payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[ReUI:EventBus] handler error for "${event}":`, err);
  }
};
