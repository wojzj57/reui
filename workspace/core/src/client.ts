/**
 * @reui/core Client（iframe 侧通讯核心，RFC-001 §3.5 / §3.6）。
 *
 * 职责：
 *   1. 解析 pluginId（options > URL `?__reui_id=`）。
 *   2. 与 Runtime 完成握手（含超时 + 指数退避重试）。
 *   3. 提供 `request` / `notify` 方法发送消息。
 *   4. 维护 push 事件订阅，自动调用 `event:subscribe` / `event:unsubscribe`。
 *   5. 自动响应 Runtime 的 `reui:ping`，无需开发者介入。
 *
 * 设计要点：
 *   - 使用 `event.source === window.parent` 验证来源，配合 sandbox iframe 防伪造；
 *   - 握手前 targetOrigin 使用 `'*'`（不知道 Runtime origin），握手后切换为 ack 中的 runtimeOrigin；
 *   - request id 形如 `{pluginId}:{sequence}`，便于 Runtime 端日志定位。
 */

import {
  PROTOCOL_VERSION,
  type HandshakeAckMessage,
  type HandshakeRejectMessage,
  type PingMessage,
  type PushMessage,
  type ResponseMessage,
} from '@reui/interface';
import {
  HANDSHAKE_MAX_RETRIES,
  HANDSHAKE_RETRY_DELAYS_MS,
  HANDSHAKE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  SDK_VERSION,
} from './constants';
import { ReUIError } from './error';

// ── 公开类型 ────────────────────────────────────────────────────────────────

export type Handler = (payload: unknown) => void;
export type Unsubscribe = () => void;

export interface InitOptions {
  /** 显式指定 pluginId（优先于 URL 参数，主要用于测试）。 */
  pluginId?: string;
  /** 单次握手等待超时（ms）。默认 5000。 */
  handshakeTimeoutMs?: number;
  /** request 默认超时（ms）。默认 30000。 */
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  method: string;
}

// ── 内部状态守卫 ────────────────────────────────────────────────────────────

type ReadyState = 'idle' | 'connecting' | 'ready' | 'failed';

// ── Client 主体 ────────────────────────────────────────────────────────────

export class Client {
  private static _instance: Client | null = null;

  /** 单例访问。`@reui/core` 默认导出此实例。 */
  static getInstance(): Client {
    if (!Client._instance) Client._instance = new Client();
    return Client._instance;
  }

  /** 仅测试使用：重置单例状态以避免用例污染。 */
  static __resetForTests(): void {
    if (Client._instance) Client._instance.dispose();
    Client._instance = null;
  }

  private state: ReadyState = 'idle';
  private requestSeq = 0;
  private pluginId = '';
  /** 握手未完成时为 `'*'`；握手成功后切换为 ack.payload.runtimeOrigin。 */
  private runtimeOrigin = '*';
  private requestTimeoutMs = REQUEST_TIMEOUT_MS;
  private handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS;

  private readonly pending = new Map<string, PendingRequest>();
  private readonly handlers = new Map<string, Set<Handler>>();

  /** 握手成功 / 失败的 promise，多个调用 `init` 共享同一个。 */
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((err: unknown) => void) | null = null;

  /** 当前等待的握手（用于超时取消）。 */
  private handshakeTimeoutId: ReturnType<typeof setTimeout> | null = null;
  /** 当前的指数退避定时器（用于 dispose 清理）。 */
  private handshakeRetryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private messageListener: ((ev: MessageEvent) => void) | null = null;

  // ──────────────────────────────────────────────────────────────────────────

  /**
   * 初始化：解析 pluginId，注册 message 监听器，发起握手。
   * 同一实例多次调用返回同一 Promise（幂等）。
   */
  init(options: InitOptions = {}): Promise<void> {
    // 复用同一 Promise 引用——多次 init 必须返回同一对象（已 ready 也保留原 promise），
    // 避免调用方持有不同引用。
    if (this.readyPromise && (this.state === 'ready' || this.state === 'connecting')) {
      return this.readyPromise;
    }

    // 上一次 init 失败后允许重试：重置 failed 状态再继续。
    if (this.state === 'failed') {
      this.state = 'idle';
      this.readyPromise = null;
    }

    try {
      this.pluginId = this.resolvePluginId(options);
    } catch (err) {
      // 同步错误也包装成 rejected Promise，保证 init 始终是 thenable。
      return Promise.reject(err);
    }

    if (options.handshakeTimeoutMs !== undefined) {
      this.handshakeTimeoutMs = options.handshakeTimeoutMs;
    }
    if (options.requestTimeoutMs !== undefined) {
      this.requestTimeoutMs = options.requestTimeoutMs;
    }

    this.state = 'connecting';
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    // 仅当 init 调用时挂载 listener，避免单例被预加载时就监听到无关消息。
    this.attachMessageListener();
    this.startHandshake(0);

    return this.readyPromise;
  }

  /**
   * 解析 pluginId（RFC-001 §3.5）。
   *
   * 解析顺序：
   *   1. options.pluginId（显式优先；测试场景与未来的 SSR 友好兼容路径）；
   *   2. URL `?__reui_id=` 查询参数（Runtime 在创建 iframe 时追加）。
   *
   * 解析失败必须抛出明确错误，提示开发者修复方式。
   */
  private resolvePluginId(options: InitOptions): string {
    if (options.pluginId) return options.pluginId;

    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('__reui_id');
    if (fromUrl) return fromUrl;

    throw new ReUIError(
      'INVALID_PARAMS',
      'init',
      '[ReUI] Cannot resolve pluginId. ' +
        'Ensure the iframe URL contains ?__reui_id=<pluginId> query parameter, ' +
        'or pass pluginId in init options.',
    );
  }

  // ── 握手 ────────────────────────────────────────────────────────────────

  /**
   * 启动一次握手尝试（首次 attempt=0，重试时 attempt>=1）。
   * 超时未收到 ack/reject 时，按指数退避序列重试。
   *
   * 注意：必须先安排 timeout，再调用 postMessage —— 因为在 jsdom 测试中
   * MockRuntime 会同步派发 ack，可能在 postMessage 调用栈内就触发
   * `completeHandshake`（它会 clear timer）。如果反序，会留下一个永远不被清理的
   * 定时器。
   */
  private startHandshake(attempt: number): void {
    this.handshakeTimeoutId = setTimeout(() => {
      this.handshakeTimeoutId = null;
      if (attempt >= HANDSHAKE_MAX_RETRIES) {
        this.failHandshake(
          new ReUIError(
            'TIMEOUT',
            'handshake',
            `[ReUI] Handshake timeout after ${HANDSHAKE_MAX_RETRIES} retries`,
          ),
        );
        return;
      }

      // 等待退避间隔后重试。
      const delayIdx = Math.min(attempt, HANDSHAKE_RETRY_DELAYS_MS.length - 1);
      const delay = HANDSHAKE_RETRY_DELAYS_MS[delayIdx]!;
      this.handshakeRetryTimeoutId = setTimeout(() => {
        this.handshakeRetryTimeoutId = null;
        this.startHandshake(attempt + 1);
      }, delay);
    }, this.handshakeTimeoutMs);

    // 握手阶段尚未获知 runtimeOrigin，使用 '*' 作为 targetOrigin。
    window.parent.postMessage(
      {
        type: 'reui:handshake',
        version: PROTOCOL_VERSION,
        payload: {
          pluginId: this.pluginId,
          sdkVersion: SDK_VERSION,
        },
      },
      '*',
    );
  }

  private clearHandshakeTimers(): void {
    if (this.handshakeTimeoutId !== null) {
      clearTimeout(this.handshakeTimeoutId);
      this.handshakeTimeoutId = null;
    }
    if (this.handshakeRetryTimeoutId !== null) {
      clearTimeout(this.handshakeRetryTimeoutId);
      this.handshakeRetryTimeoutId = null;
    }
  }

  private failHandshake(err: ReUIError): void {
    this.clearHandshakeTimers();
    this.state = 'failed';
    const reject = this.rejectReady;
    this.rejectReady = null;
    this.resolveReady = null;
    if (reject) reject(err);
  }

  private completeHandshake(ack: HandshakeAckMessage): void {
    this.clearHandshakeTimers();
    this.runtimeOrigin = ack.payload.runtimeOrigin || '*';
    this.state = 'ready';
    const resolve = this.resolveReady;
    this.resolveReady = null;
    this.rejectReady = null;
    if (resolve) resolve();
  }

  // ── Request / Notify ───────────────────────────────────────────────────

  /**
   * 发送一个 RPC 请求并等待响应。
   * 在握手未完成时，请求会等待 ready 后再实际发出（避免 NOT_READY 错误）。
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.ensureReady();

    const id = `${this.pluginId}:${++this.requestSeq}`;
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // 超时清理 pending，否则即使后续响应到达也无人 resolve，造成内存泄漏。
        this.pending.delete(id);
        reject(
          new ReUIError('TIMEOUT', method, `[ReUI] Request "${method}" timed out after ${this.requestTimeoutMs}ms`),
        );
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timeoutId,
        method,
      });

      window.parent.postMessage(
        {
          type: 'reui:request',
          version: PROTOCOL_VERSION,
          id,
          method,
          ...(params === undefined ? {} : { params }),
        },
        this.runtimeOrigin,
      );
    });
  }

  /**
   * 发送 fire-and-forget 通知（不等待响应）。
   */
  async notify(method: string, params?: unknown): Promise<void> {
    await this.ensureReady();
    window.parent.postMessage(
      {
        type: 'reui:notify',
        version: PROTOCOL_VERSION,
        method,
        ...(params === undefined ? {} : { params }),
      },
      this.runtimeOrigin,
    );
  }

  /** 返回握手就绪 Promise。从未调用过 `init` 时抛出 NOT_READY。 */
  private ensureReady(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    if (this.readyPromise) return this.readyPromise;
    return Promise.reject(
      new ReUIError(
        'NOT_READY',
        'request',
        '[ReUI] Client is not initialized. Call init() before using SDK methods.',
      ),
    );
  }

  // ── Push 订阅 ──────────────────────────────────────────────────────────

  /**
   * 订阅 Runtime 推送的事件。
   *
   * 首次订阅某 event 时，自动向 Runtime 发送 `event:subscribe` 请求（去重）。
   * 取消订阅时，最后一个 handler 移除会自动发送 `event:unsubscribe`。
   *
   * 在 init 前调用：本地 handler 立即注册，subscribe 请求会等待握手完成。
   */
  onPush(event: string, handler: Handler): Unsubscribe {
    let bucket = this.handlers.get(event);
    const isNew = !bucket;
    if (!bucket) {
      bucket = new Set();
      this.handlers.set(event, bucket);
    }
    bucket.add(handler);

    if (isNew) {
      // 首次订阅：通知 Runtime。失败仅打 warn，不影响业务（订阅本身是幂等的）。
      void this.request('event:subscribe', { event }).catch((err) => {
        // 失败时回退本地注册，避免后续 unsubscribe 调用产生孤儿订阅。
        this.handlers.get(event)?.delete(handler);
        if (this.handlers.get(event)?.size === 0) this.handlers.delete(event);
        // eslint-disable-next-line no-console
        console.warn(`[ReUI] Failed to subscribe to "${event}":`, err);
      });
    }

    return () => this.offPush(event, handler);
  }

  private offPush(event: string, handler: Handler): void {
    const bucket = this.handlers.get(event);
    if (!bucket) return;
    if (!bucket.delete(handler)) return; // handler 已经被移除过，幂等。

    if (bucket.size === 0) {
      this.handlers.delete(event);
      void this.request('event:unsubscribe', { event }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[ReUI] Failed to unsubscribe from "${event}":`, err);
      });
    }
  }

  // ── 消息处理 ───────────────────────────────────────────────────────────

  private attachMessageListener(): void {
    if (this.messageListener) return;
    this.messageListener = (ev) => this.handleMessage(ev);
    window.addEventListener('message', this.messageListener);
  }

  private detachMessageListener(): void {
    if (!this.messageListener) return;
    window.removeEventListener('message', this.messageListener);
    this.messageListener = null;
  }

  /**
   * 入口：源验证 + 协议前缀过滤 + 类型分发。
   *
   * 注意：`event.source === window.parent` 是核心安全检查——
   * sandbox iframe 的 origin 为 'null' 字符串，无法基于 origin 做白名单。
   */
  private handleMessage(event: MessageEvent): void {
    if (event.source !== window.parent) return;

    const data = event.data as { type?: unknown } | null | undefined;
    if (!data || typeof data !== 'object') return;
    const type = (data as { type?: unknown }).type;
    if (typeof type !== 'string' || !type.startsWith('reui:')) return;

    switch (type) {
      case 'reui:handshake-ack':
        this.handleAck(data as HandshakeAckMessage);
        return;
      case 'reui:handshake-reject':
        this.handleReject(data as HandshakeRejectMessage);
        return;
      case 'reui:response':
        this.handleResponse(data as ResponseMessage);
        return;
      case 'reui:push':
        this.handlePush(data as PushMessage);
        return;
      case 'reui:ping':
        this.handlePing(data as PingMessage);
        return;
      default:
        // 未知 reui:* 消息：未来扩展时不应破坏旧 SDK，静默忽略。
        return;
    }
  }

  private handleAck(msg: HandshakeAckMessage): void {
    if (this.state !== 'connecting') return; // 重复 ack：忽略。
    if (msg.version !== PROTOCOL_VERSION) {
      this.failHandshake(
        new ReUIError(
          'VERSION_MISMATCH',
          'handshake',
          `[ReUI] Runtime ack version mismatch: expected ${PROTOCOL_VERSION}, got ${msg.version}`,
        ),
      );
      return;
    }
    this.completeHandshake(msg);
  }

  private handleReject(msg: HandshakeRejectMessage): void {
    if (this.state !== 'connecting') return;
    const { code, reason } = msg.payload;
    // RFC-001 §3.6：HandshakeRejectCode 是 ErrorCode 的字面量子集，可直接赋值。
    this.failHandshake(new ReUIError(code, 'handshake', reason));
  }

  private handleResponse(msg: ResponseMessage): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return; // 已超时清理 / 未知 id：忽略。

    this.pending.delete(msg.id);
    clearTimeout(pending.timeoutId);

    if (msg.success) {
      pending.resolve(msg.result);
    } else {
      pending.reject(new ReUIError(msg.error.code, pending.method, msg.error.message, msg.error.details));
    }
  }

  private handlePush(msg: PushMessage): void {
    const bucket = this.handlers.get(msg.event);
    if (!bucket || bucket.size === 0) return;
    // 复制一份避免 handler 在迭代过程中调用 offPush 修改集合。
    for (const handler of [...bucket]) {
      try {
        handler(msg.payload);
      } catch (err) {
        // 单个 handler 抛错不能影响其它订阅者。
        // eslint-disable-next-line no-console
        console.error(`[ReUI] Push handler for "${msg.event}" threw:`, err);
      }
    }
  }

  /**
   * 自动响应 Runtime 心跳 ping：透传 timestamp 以便 Runtime 计算 RTT。
   * 不依赖 ready 状态——握手期间也允许 pong（理论上 Runtime 不会在握手前发 ping，
   * 但保留容错以防 race）。
   */
  private handlePing(msg: PingMessage): void {
    window.parent.postMessage(
      {
        type: 'reui:pong',
        version: PROTOCOL_VERSION,
        pluginId: this.pluginId,
        timestamp: msg.timestamp,
      },
      this.runtimeOrigin,
    );
  }

  // ── 清理 ────────────────────────────────────────────────────────────────

  /** 清理所有定时器、监听器与待决请求。供测试 / 热重载场景调用。 */
  dispose(): void {
    this.clearHandshakeTimers();
    this.detachMessageListener();

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new ReUIError('RUNTIME_ERROR', pending.method, '[ReUI] Client disposed'));
    }
    this.pending.clear();
    this.handlers.clear();

    this.state = 'idle';
    this.requestSeq = 0;
    this.runtimeOrigin = '*';
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
  }

  // ── 内省（仅测试 / 调试） ───────────────────────────────────────────────

  /** @internal 测试辅助：当前是否已 ready。 */
  get isReady(): boolean {
    return this.state === 'ready';
  }

  /** @internal 测试辅助：当前 pending 请求数（断言资源无泄漏）。 */
  get pendingSize(): number {
    return this.pending.size;
  }

  /** @internal 测试辅助：当前已订阅的 event 数。 */
  get subscriptionSize(): number {
    return this.handlers.size;
  }

  /** @internal 测试辅助：当前 runtimeOrigin（握手前为 '*'）。 */
  get currentRuntimeOrigin(): string {
    return this.runtimeOrigin;
  }

  /** 当前插件 id（init 后可用，未 init 时为空字符串）。SDK 模块据此过滤自身事件。 */
  get id(): string {
    return this.pluginId;
  }
}
