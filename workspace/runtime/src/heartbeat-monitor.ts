/**
 * HeartbeatMonitor（RFC-001 §3.7）。
 *
 * Runtime 侧维护每个插件 iframe 的心跳：
 *   1. 周期性向插件发送 `reui:ping`（默认每 10s 一轮）；
 *   2. 接到插件回的 `reui:pong` 时调用 `handlePong` 重置计数；
 *   3. 连续 MAX_MISSED 个周期无 pong → emit `plugin:crashed`，
 *      同时 stop 该插件的监控（不会再发 ping）。
 *
 * 暂停 / 恢复：
 *   - `pause`：清掉 interval，保留 lastPong / missedCounts，期间不发 ping；
 *   - `resume`：重置 lastPong / missedCounts 后再启动 interval——
 *     避免 pause 期间累积的时间被错误判定为漏 pong。
 *
 * 关键约定：
 *   1. 单例风格与 EventBus / AuthService / NuiBridge 一致；
 *   2. 用 `setInterval` + `Date.now()`（而非 performance.now），
 *      便于测试用 fake timers + `vi.setSystemTime` 控制时序；
 *   3. handleCrash 后立刻 stop，确保事件只 emit 一次。
 */

import { EventBus } from './event-bus';

export interface HeartbeatTarget {
  pluginId: string;
  postMessage: (msg: { type: 'reui:ping'; ts: number }) => void;
}

export class HeartbeatMonitor {
  private static _instance: HeartbeatMonitor | null = null;

  /** 心跳周期：每 PING_INTERVAL 毫秒发一次 ping。 */
  private readonly PING_INTERVAL = 10_000;
  /** pong 超时：lastPong 距今超过此值即视为本轮漏 pong。 */
  private readonly PONG_TIMEOUT = 5_000;
  /** 最大可容忍的连续漏 pong 次数，达到即崩溃。 */
  private readonly MAX_MISSED = 3;

  private readonly eventBus: EventBus;
  private readonly targets = new Map<string, HeartbeatTarget>();
  private readonly intervals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly lastPong = new Map<string, number>();
  private readonly missedCounts = new Map<string, number>();
  private readonly paused = new Set<string>();

  constructor(eventBus: EventBus = EventBus.getInstance()) {
    this.eventBus = eventBus;
  }

  static getInstance(eventBus?: EventBus): HeartbeatMonitor {
    if (!HeartbeatMonitor._instance) {
      HeartbeatMonitor._instance = new HeartbeatMonitor(eventBus);
    }
    return HeartbeatMonitor._instance;
  }

  /** 仅测试使用：重置单例避免用例间状态泄漏。 */
  static __resetForTests(): void {
    if (HeartbeatMonitor._instance) {
      HeartbeatMonitor._instance.stopAll();
    }
    HeartbeatMonitor._instance = null;
  }

  // ── 公开 API ─────────────────────────────────────────────────────────

  /**
   * 开始监控某 target。若已在监控同一 pluginId，先 stop 再重建——
   * 避免 interval 重复导致双倍发送 ping。
   */
  start(target: HeartbeatTarget): void {
    const { pluginId } = target;
    if (this.targets.has(pluginId)) {
      this.stop(pluginId);
    }
    this.targets.set(pluginId, target);
    this.lastPong.set(pluginId, Date.now());
    this.missedCounts.set(pluginId, 0);
    const handle = setInterval(() => this.tick(pluginId), this.PING_INTERVAL);
    this.intervals.set(pluginId, handle);
  }

  /** 停止某插件的监控，清空所有相关状态。 */
  stop(pluginId: string): void {
    const handle = this.intervals.get(pluginId);
    if (handle !== undefined) {
      clearInterval(handle);
    }
    this.intervals.delete(pluginId);
    this.targets.delete(pluginId);
    this.lastPong.delete(pluginId);
    this.missedCounts.delete(pluginId);
    this.paused.delete(pluginId);
  }

  /** 一次性停止所有插件的监控。 */
  stopAll(): void {
    for (const pluginId of [...this.targets.keys()]) {
      this.stop(pluginId);
    }
  }

  /**
   * 收到插件回的 pong，重置最后心跳时间与漏 pong 计数。
   * 对未注册的 pluginId 静默忽略，保持调用方代码简单。
   */
  handlePong(pluginId: string): void {
    if (!this.targets.has(pluginId)) return;
    this.lastPong.set(pluginId, Date.now());
    this.missedCounts.set(pluginId, 0);
  }

  /**
   * 暂停某插件的心跳（节流场景，比如插件 iframe 不可见）。
   * 保留 lastPong 与 missedCounts，仅清 interval。
   */
  pause(pluginId: string): void {
    if (!this.targets.has(pluginId)) return;
    if (this.paused.has(pluginId)) return;
    this.paused.add(pluginId);
    const handle = this.intervals.get(pluginId);
    if (handle !== undefined) {
      clearInterval(handle);
      this.intervals.delete(pluginId);
    }
  }

  /**
   * 恢复某插件的心跳。重置 lastPong / missedCounts，
   * 避免 pause 期间累积的时间被误判为漏 pong。
   */
  resume(pluginId: string): void {
    if (!this.paused.has(pluginId)) return;
    // 不变量：stop / __resetForTests 都会同时清掉 paused，所以
    // paused.has(pluginId) ⇒ targets.has(pluginId)，无需重复判空。
    this.paused.delete(pluginId);
    this.lastPong.set(pluginId, Date.now());
    this.missedCounts.set(pluginId, 0);
    const handle = setInterval(() => this.tick(pluginId), this.PING_INTERVAL);
    this.intervals.set(pluginId, handle);
  }

  isMonitoring(pluginId: string): boolean {
    return this.targets.has(pluginId);
  }

  // ── 内部：一次心跳周期 ────────────────────────────────────────────────

  private tick(pluginId: string): void {
    const target = this.targets.get(pluginId);
    if (!target) return;
    const now = Date.now();
    const last = this.lastPong.get(pluginId) ?? now;
    if (now - last > this.PONG_TIMEOUT) {
      const missed = (this.missedCounts.get(pluginId) ?? 0) + 1;
      this.missedCounts.set(pluginId, missed);
      if (missed >= this.MAX_MISSED) {
        this.handleCrash(pluginId);
        return;
      }
    }
    target.postMessage({ type: 'reui:ping', ts: now });
  }

  private handleCrash(pluginId: string): void {
    this.stop(pluginId);
    this.eventBus.emit('plugin:crashed', {
      pluginId,
      reason: 'heartbeat-timeout',
    });
  }
}
