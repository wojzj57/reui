/**
 * WebSocketManager（RFC-003 §3.2）。
 *
 * 整个 Runtime 共享**单条** WebSocket 连接；所有插件通过 channel 复用。
 * 入站消息按 channel 经 EventBus 派发（`ws:${channel}`），连接状态变更经
 * `ws:stateChanged` 广播——与 NuiBridge 把游戏事件转发到 EventBus 的模式一致，
 * 插件侧通过 `event:subscribe` 订阅即可收到 push。
 *
 * 关键行为：
 *   1. 指数退避自动重连：初始 1s、上限 30s、默认最多 10 次；
 *   2. 离线发送缓冲：未连接时入队（上限 100，溢出按 FIFO 淘汰最旧），
 *      重连成功后自动 flush；
 *   3. 单例 + 依赖注入：可注入 WebSocket 构造器与 EventBus 便于测试。
 *
 * 约定：本类不直接发 reui:push——推送统一走 EventBus → PostMessageRouter
 * 的订阅链路。
 */

import { EventBus } from './event-bus';
import type { WSState } from '@reui/interface';

/** 测试可注入的最小 WebSocket 形态。 */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WebSocketCtor = new (
  url: string,
  protocols?: string | string[],
) => WebSocketLike;

export interface WSConnectOptions {
  /** 子协议。 */
  protocols?: string | string[];
  /** 最大重连次数。默认 10。 */
  maxRetries?: number;
}

export interface WebSocketManagerOptions {
  eventBus?: EventBus;
  /** 注入 WebSocket 构造器（默认全局 WebSocket）。 */
  WebSocketCtor?: WebSocketCtor;
}

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_MAX_RETRIES = 10;
const MAX_QUEUE = 100;

/** WebSocket.OPEN 常量值（避免依赖全局枚举）。 */
const WS_OPEN = 1;

interface QueuedMessage {
  channel: string;
  data: unknown;
}

export class WebSocketManager {
  private static _instance: WebSocketManager | null = null;

  private readonly eventBus: EventBus;
  /** 注入的 WebSocket 构造器（未注入时在 open() 时惰性解析全局 WebSocket）。 */
  private readonly injectedCtor: WebSocketCtor | undefined;

  private ws: WebSocketLike | null = null;
  private _state: WSState = 'disconnected';

  private url: string | null = null;
  private protocols: string | string[] | undefined;
  private maxRetries = DEFAULT_MAX_RETRIES;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 手动 disconnect 时置位，阻止 onclose 触发自动重连。 */
  private manualClose = false;

  private readonly queue: QueuedMessage[] = [];

  constructor(opts: WebSocketManagerOptions = {}) {
    this.eventBus = opts.eventBus ?? EventBus.getInstance();
    this.injectedCtor = opts.WebSocketCtor;
  }

  static getInstance(opts?: WebSocketManagerOptions): WebSocketManager {
    if (!WebSocketManager._instance) {
      WebSocketManager._instance = new WebSocketManager(opts);
    }
    return WebSocketManager._instance;
  }

  /** 仅测试使用：断开并重置单例。 */
  static __resetForTests(): void {
    if (WebSocketManager._instance) {
      WebSocketManager._instance.disconnect();
    }
    WebSocketManager._instance = null;
  }

  get state(): WSState {
    return this._state;
  }

  // ── 连接管理 ─────────────────────────────────────────────────────────

  connect(url: string, options: WSConnectOptions = {}): void {
    // 关闭并解绑既有连接，避免重复 connect 泄漏旧 socket 或其陈旧回调
    // 误触发重连。
    this.teardownSocket();
    this.clearReconnectTimer();
    this.url = url;
    this.protocols = options.protocols;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.manualClose = false;
    this.attempts = 0;
    this.open();
  }

  disconnect(): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    this.teardownSocket();
    this.setState('disconnected');
  }

  /** 发送消息到指定 channel；未连接时入离线队列。 */
  send(channel: string, data: unknown): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify({ channel, data }));
      return;
    }
    // 离线：入队，超出上限按 FIFO 淘汰最旧。
    this.queue.push({ channel, data });
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  /** 订阅某 channel 的入站消息（Runtime 内部消费者用；插件走 event:subscribe）。 */
  subscribe(channel: string, handler: (data: unknown) => void): () => void {
    return this.eventBus.on(`ws:${channel}`, handler);
  }

  unsubscribe(channel: string, handler: (data: unknown) => void): void {
    this.eventBus.off(`ws:${channel}`, handler);
  }

  // ── 内部 ─────────────────────────────────────────────────────────────

  private open(): void {
    if (this.url === null) return;

    const Ctor =
      this.injectedCtor ??
      (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Ctor) {
      // 运行环境无 WebSocket 实现：无法连接，停在 disconnected，
      // 不进入无限重连。
      this.setState('disconnected');
      return;
    }

    this.setState(this.attempts === 0 ? 'connecting' : 'reconnecting');

    let ws: WebSocketLike;
    try {
      ws = new Ctor(this.url, this.protocols);
    } catch {
      // 构造失败（非法 URL / 被安全策略拦截）：按一次连接失败处理，
      // 走退避重连，而不是把异常抛出到 setTimeout 回调外。
      this.ws = null;
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    // 所有回调先校验 `this.ws === ws`，忽略来自陈旧 socket 的事件，
    // 避免旧连接的 onclose 把新连接误置空并触发多余重连。
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempts = 0;
      this.setState('connected');
      this.flushQueue();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.handleInbound(ev.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (this.manualClose) return;
      this.ws = null;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onerror 后浏览器通常会继续触发 onclose；此处不额外处理，
      // 交给 onclose 的重连逻辑，避免重复调度。
    };
  }

  /** 解绑回调并关闭当前 socket（幂等）。 */
  private teardownSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    this.ws = null;
    try {
      ws.close();
    } catch {
      // 忽略关闭异常——状态机不依赖关闭是否成功。
    }
  }

  private handleInbound(raw: unknown): void {
    const parsed = parseInbound(raw);
    if (!parsed) return;
    this.eventBus.emit(`ws:${parsed.channel}`, parsed.data);
  }

  private scheduleReconnect(): void {
    if (this.attempts >= this.maxRetries) {
      this.setState('disconnected');
      return;
    }
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.attempts,
      MAX_RECONNECT_DELAY_MS,
    );
    this.attempts += 1;
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return;
    while (this.queue.length > 0) {
      const msg = this.queue.shift()!;
      this.ws.send(JSON.stringify({ channel: msg.channel, data: msg.data }));
    }
  }

  private setState(next: WSState): void {
    if (this._state === next) return;
    this._state = next;
    this.eventBus.emit('ws:stateChanged', next);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/** 解析入站帧：期望 `{ channel: string, data?: unknown }`（JSON 字符串或对象）。 */
const parseInbound = (
  raw: unknown,
): { channel: string; data: unknown } | null => {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  const channel = value['channel'];
  if (typeof channel !== 'string' || channel.length === 0) return null;
  return { channel, data: value['data'] };
};
