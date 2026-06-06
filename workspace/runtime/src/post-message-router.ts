/**
 * PostMessageRouter（RFC-001 §3.3 / RFC-003 §3.5 — Stage A1）。
 *
 * 由 MessageDispatcher 把"已注册 iframe 的 reui:* 消息"喂进
 * `handlePluginMessage(plugin, raw)`。本类承担：
 *   1. 用 @reui/interface 暴露的 Zod schema 校验信封；
 *   2. 协议版本一致性检查；
 *   3. 类型分流：handshake / request / notify / pong；
 *   4. method 注册表 + capability 校验，handler 结果包成 reui:response；
 *   5. 通过 EventBus.subscribeForPlugin 维持订阅，并在 EventBus
 *      触发时把 reui:push 推回插件；
 *   6. 监听 EventBus `plugin:unloaded`，一次性清理该插件全部订阅。
 *
 * 关键约定：
 *   - 协议消息形态以 `workspace/interface/src/protocol/messages.ts` 为准
 *     （response 用 `success`，handshake-reject 用 `{reason, code}` 等）；
 *   - handshake-ack 的 `runtimeOrigin` 必须填实，永不发空字符串；
 *   - 严禁 `as any`，所有外部输入用 unknown + Zod / type guard；
 *   - 已注册 event:* / auth:* / nui:* / plugin:* / http:request / ws:* —— 见
 *     registerBuiltinMethods；system:* / exports:* 仍未注册（后续 RFC）；
 *   - notify handler 抛错只 emit `router:error`，不通知插件。
 */

import {
  PROTOCOL_VERSION,
  anyMessageSchema,
  type AnyMessage,
  type ErrorCode,
  type HandshakeMessage,
  type HandshakeRejectCode,
  type HandshakeRejectMessage,
  type HandshakeAckMessage,
  type RequestMessage,
  type NotifyMessage,
  type PushMessage,
  type ErrorResponseMessage,
  type SuccessResponseMessage,
} from '@reui/interface';

import { AuthService } from './auth-service';
import { EventBus, type Unsubscribe } from './event-bus';
import { HeartbeatMonitor } from './heartbeat-monitor';
import { HttpClient, type HttpRequestConfig, type HttpMethod } from './http-client';
import { NuiBridge } from './nui-bridge';
import { WebSocketManager } from './websocket-manager';
import {
  PluginManager,
  PluginManagerError,
  type PluginInstance,
} from './plugin-manager';
import type { MessageDispatcherRouterLike } from './message-dispatcher';
import { isNamespaceError, parseEventName } from './event-namespace';

// ── 公开类型 ─────────────────────────────────────────────────────────────

export interface RequestHandlerCtx {
  plugin: PluginInstance;
  params: unknown;
}

export type RequestHandler = (
  ctx: RequestHandlerCtx,
) => Promise<unknown> | unknown;

export interface PostMessageRouterOptions {
  pluginManager?: PluginManager;
  eventBus?: EventBus;
  authService?: AuthService;
  nuiBridge?: NuiBridge;
  heartbeat?: HeartbeatMonitor;
  httpClient?: HttpClient;
  webSocketManager?: WebSocketManager;
}

interface RegisteredHandler {
  handler: RequestHandler;
  capability?: string;
}

// 当 handler 抛出的错误自带 code / message / details 时，按其值透传。
interface CodedError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

// ── 类型守卫 ─────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const ALL_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'TIMEOUT',
  'NOT_READY',
  'PERMISSION_DENIED',
  'CAPABILITY_DENIED',
  'METHOD_NOT_FOUND',
  'INVALID_PARAMS',
  'VERSION_MISMATCH',
  'RUNTIME_ERROR',
  'NETWORK_ERROR',
  'PLUGIN_NOT_FOUND',
  'EVENT_DENIED',
  'HANDSHAKE_REJECTED',
  'UNKNOWN_PLUGIN',
  'PAYLOAD_TOO_LARGE',
]);

const isErrorCode = (v: unknown): v is ErrorCode =>
  typeof v === 'string' && ALL_ERROR_CODES.has(v as ErrorCode);

const isCodedError = (err: unknown): err is CodedError => {
  if (!isRecord(err)) return false;
  const code = err['code'];
  const message = err['message'];
  return isErrorCode(code) && typeof message === 'string';
};

const getStringField = (
  source: unknown,
  key: string,
): string | undefined => {
  if (!isRecord(source)) return undefined;
  const v = source[key];
  return typeof v === 'string' ? v : undefined;
};

const getStringArrayField = (
  source: unknown,
  key: string,
): string[] | undefined => {
  if (!isRecord(source)) return undefined;
  const v = source[key];
  if (!Array.isArray(v)) return undefined;
  for (const item of v) {
    if (typeof item !== 'string') return undefined;
  }
  return v as string[];
};

// 抛出此异常即可让 handler 流程把任意 ErrorCode 透传给插件。
class RouterError extends Error implements CodedError {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// ── 主体 ────────────────────────────────────────────────────────────────

export class PostMessageRouter implements MessageDispatcherRouterLike {
  private static _instance: PostMessageRouter | null = null;

  private readonly pluginManager: PluginManager;
  private readonly eventBus: EventBus;
  private readonly authService: AuthService;
  private readonly nuiBridge: NuiBridge;
  private readonly heartbeat: HeartbeatMonitor;
  private readonly httpClient: HttpClient;
  private readonly webSocketManager: WebSocketManager;

  private readonly methods = new Map<string, RegisteredHandler>();
  /** pluginId -> (event -> Unsubscribe)。订阅清理与重复订阅守卫均依赖此 Map。 */
  private readonly subscriptions = new Map<string, Map<string, Unsubscribe>>();

  private readonly unloadUnsubscribe: Unsubscribe;
  /** 构造期挂的服务→EventBus 桥接订阅，dispose 时一并解绑。 */
  private readonly bridgeUnsubscribes: Unsubscribe[] = [];

  constructor(opts: PostMessageRouterOptions = {}) {
    this.pluginManager = opts.pluginManager ?? PluginManager.getInstance();
    this.eventBus = opts.eventBus ?? EventBus.getInstance();
    this.authService = opts.authService ?? AuthService.getInstance();
    this.nuiBridge = opts.nuiBridge ?? NuiBridge.getInstance();
    this.heartbeat = opts.heartbeat ?? HeartbeatMonitor.getInstance();
    this.httpClient = opts.httpClient ?? HttpClient.getInstance();
    this.webSocketManager =
      opts.webSocketManager ?? WebSocketManager.getInstance();

    this.unloadUnsubscribe = this.eventBus.on('plugin:unloaded', (payload) => {
      const pluginId = getStringField(payload, 'pluginId');
      if (pluginId !== undefined) this.cleanupPluginSubscriptions(pluginId);
    });

    // 认证状态变更桥接到 EventBus，供订阅了 auth:* 的插件收到 push。
    // （ws:* 由 WebSocketManager 自身桥接；nui:* 由 NuiBridge 桥接。）
    this.bridgeUnsubscribes.push(
      this.authService.onUserChange((user) =>
        this.eventBus.emit('auth:userChanged', user),
      ),
      this.authService.onPermissionChange((permissions) =>
        this.eventBus.emit('auth:permissionsChanged', permissions),
      ),
    );

    this.registerBuiltinMethods();
  }

  static getInstance(opts?: PostMessageRouterOptions): PostMessageRouter {
    if (!PostMessageRouter._instance) {
      PostMessageRouter._instance = new PostMessageRouter(opts);
    }
    return PostMessageRouter._instance;
  }

  /** 仅测试使用：先 dispose 再清空单例。 */
  static __resetForTests(): void {
    if (PostMessageRouter._instance) {
      PostMessageRouter._instance.dispose();
    }
    PostMessageRouter._instance = null;
  }

  // ── 公开 API ─────────────────────────────────────────────────────────

  registerHandler(
    method: string,
    handler: RequestHandler,
    requiredCapability?: string,
  ): void {
    this.methods.set(method, { handler, capability: requiredCapability });
  }

  unregisterHandler(method: string): void {
    this.methods.delete(method);
  }

  /** MessageDispatcher 入口。 */
  handlePluginMessage(plugin: PluginInstance, raw: unknown): void {
    // 1. 版本检查必须在 schema 之前——anyMessageSchema 把 version 限定为
    //    literal(PROTOCOL_VERSION)，错版本会被当成"格式错误"丢弃，无法
    //    给出明确的 VERSION_MISMATCH 响应。
    if (this.handleVersionMismatch(plugin, raw)) return;

    // 2. Zod 校验信封。
    const parsed = anyMessageSchema.safeParse(raw);
    if (!parsed.success) {
      devWarn(
        `dropped malformed message from plugin '${plugin.id}'`,
        parsed.error,
      );
      return;
    }
    const data: AnyMessage = parsed.data;

    switch (data.type) {
      case 'reui:handshake':
        this.handleHandshake(plugin, data);
        return;
      case 'reui:request':
        void this.handleRequest(plugin, data);
        return;
      case 'reui:notify':
        void this.handleNotify(plugin, data);
        return;
      case 'reui:pong':
        this.heartbeat.handlePong(plugin.id);
        return;
      default:
        // 其它合法 reui 消息（ack / reject / response / push / ping）
        // 不应由插件发出，静默丢弃 + DEV warn。
        devWarn(
          `dropped unexpected message type '${data.type}' from plugin '${plugin.id}'`,
        );
        return;
    }
  }

  dispose(): void {
    this.unloadUnsubscribe();
    for (const unsub of this.bridgeUnsubscribes) unsub();
    this.bridgeUnsubscribes.length = 0;
    for (const pluginId of [...this.subscriptions.keys()]) {
      this.cleanupPluginSubscriptions(pluginId);
    }
    this.methods.clear();
  }

  // ── 协议处理 ─────────────────────────────────────────────────────────

  /**
   * 当 raw 形如 `{type:'reui:...', version:number, ...}` 但 version !==
   * PROTOCOL_VERSION 时：
   *   - request → 回 error response VERSION_MISMATCH（含 details.expected/got）；
   *   - handshake → 回 handshake-reject VERSION_MISMATCH；
   *   - 其它 → 静默丢弃。
   * 返回 true 表示已识别为 mismatch（调用方应停止后续分发）。
   */
  private handleVersionMismatch(plugin: PluginInstance, raw: unknown): boolean {
    if (!isRecord(raw)) return false;
    const type = raw['type'];
    const version = raw['version'];
    if (typeof type !== 'string' || !type.startsWith('reui:')) return false;
    if (typeof version !== 'number') return false;
    if (version === PROTOCOL_VERSION) return false;

    if (type === 'reui:request') {
      const id = getStringField(raw, 'id');
      if (id !== undefined) {
        this.sendError(
          plugin,
          id,
          'VERSION_MISMATCH',
          'Protocol version mismatch',
          { expected: PROTOCOL_VERSION, got: version },
        );
      }
    } else if (type === 'reui:handshake') {
      this.sendHandshakeReject(
        plugin,
        'VERSION_MISMATCH',
        `Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${version}`,
      );
    }
    // 其它类型（notify / pong 等）静默丢弃。
    return true;
  }

  private handleHandshake(plugin: PluginInstance, msg: HandshakeMessage): void {
    if (msg.payload.pluginId !== plugin.id) {
      this.sendHandshakeReject(plugin, 'UNKNOWN_PLUGIN',
        `Handshake pluginId '${msg.payload.pluginId}' does not match registered plugin '${plugin.id}'`,
      );
      return;
    }
    // protocolVersion 已经在 handleVersionMismatch 与 anyMessageSchema 两道
    // 闸门处校验过——schema 把 version 限定为 literal(PROTOCOL_VERSION)，
    // 走到这里的 msg.version 必然等于 PROTOCOL_VERSION。无需再做重复检查。
    this.pluginManager.markReady(plugin.id);

    const ack: HandshakeAckMessage = {
      type: 'reui:handshake-ack',
      version: PROTOCOL_VERSION,
      payload: {
        sessionId: `${plugin.id}:${Date.now()}`,
        pluginId: plugin.id,
        runtimeOrigin: getRuntimeOrigin(plugin),
        permissions: plugin.manifest.permissions ?? [],
        config: {
          layer: plugin.manifest.layer,
          allowedEvents: [],
        },
      },
    };
    plugin.postMessage(ack);
  }

  private async handleRequest(
    plugin: PluginInstance,
    msg: RequestMessage,
  ): Promise<void> {
    try {
      const result = await this.invokeMethod(plugin, msg.method, msg.params);
      this.sendSuccess(plugin, msg.id, result);
    } catch (err) {
      const { code, message, details } = toErrorResponse(err);
      this.sendError(plugin, msg.id, code, message, details);
    }
  }

  private async handleNotify(
    plugin: PluginInstance,
    msg: NotifyMessage,
  ): Promise<void> {
    try {
      await this.invokeMethod(plugin, msg.method, msg.params);
    } catch (err) {
      // notify 不发响应，仅广播 router:error 便于观测。
      this.eventBus.emit('router:error', {
        pluginId: plugin.id,
        method: msg.method,
        error: err,
      });
    }
  }

  private async invokeMethod(
    plugin: PluginInstance,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const entry = this.methods.get(method);
    if (!entry) {
      throw new RouterError(
        'METHOD_NOT_FOUND',
        `Method '${method}' is not registered`,
      );
    }
    if (entry.capability !== undefined) {
      const granted = plugin.manifest.permissions ?? [];
      if (!granted.includes(entry.capability)) {
        throw new RouterError(
          'CAPABILITY_DENIED',
          `Plugin '${plugin.id}' lacks capability '${entry.capability}' required for method '${method}'`,
          { capability: entry.capability },
        );
      }
    }
    return await Promise.resolve(entry.handler({ plugin, params }));
  }

  // ── 内置 method ──────────────────────────────────────────────────────

  private registerBuiltinMethods(): void {
    // auth:* —— 无 capability 即可读。token 不在此处暴露。
    this.registerHandler('auth:getUser', () => this.authService.getUser());

    this.registerHandler('auth:hasPermission', ({ params }) => {
      const permission = getStringField(params, 'permission');
      if (permission === undefined) {
        throw new RouterError(
          'INVALID_PARAMS',
          'auth:hasPermission requires { permission: string }',
        );
      }
      return this.authService.hasPermission(permission);
    });

    this.registerHandler('auth:checkPermissions', ({ params }) => {
      const permissions = getStringArrayField(params, 'permissions');
      if (permissions === undefined) {
        throw new RouterError(
          'INVALID_PARAMS',
          'auth:checkPermissions requires { permissions: string[] }',
        );
      }
      return this.authService.hasAllPermissions(permissions);
    });

    this.registerHandler('auth:getRoles', () => this.authService.getRoles());

    // nui:send —— Runtime → Game callback。
    this.registerHandler(
      'nui:send',
      async ({ params }) => {
        const eventName = getStringField(params, 'event');
        if (eventName === undefined) {
          throw new RouterError(
            'INVALID_PARAMS',
            'nui:send requires { event: string, data?: unknown }',
          );
        }
        const data = isRecord(params) ? params['data'] : undefined;
        return await this.nuiBridge.sendToGame(eventName, data);
      },
      'runtime.message',
    );

    // event:* —— EventBus 中转。
    this.registerHandler('event:subscribe', ({ plugin, params }) => {
      const eventName = getStringField(params, 'event');
      if (eventName === undefined) {
        throw new RouterError(
          'INVALID_PARAMS',
          'event:subscribe requires { event: string }',
        );
      }
      const parsed = parseEventName(eventName);
      if (isNamespaceError(parsed)) {
        throw new RouterError(parsed.code, parsed.message);
      }
      this.subscribeForPlugin(plugin, eventName);
      return { ok: true };
    });

    this.registerHandler('event:unsubscribe', ({ plugin, params }) => {
      const eventName = getStringField(params, 'event');
      if (eventName === undefined) {
        throw new RouterError(
          'INVALID_PARAMS',
          'event:unsubscribe requires { event: string }',
        );
      }
      this.unsubscribeForPlugin(plugin.id, eventName);
      return { ok: true };
    });

    this.registerHandler(
      'event:emit',
      ({ params }) => {
        const eventName = getStringField(params, 'event');
        if (eventName === undefined) {
          throw new RouterError(
            'INVALID_PARAMS',
            'event:emit requires { event: string, payload?: unknown }',
          );
        }
        const payload = isRecord(params) ? params['payload'] : undefined;
        this.eventBus.emit(eventName, payload);
        return { ok: true };
      },
      'events.emit',
    );

    // plugin:* —— 自身配置与可见性。
    this.registerHandler('plugin:getConfig', ({ plugin }) => plugin.manifest);
    this.registerHandler(
      'plugin:show',
      ({ plugin }) => {
        this.pluginManager.showPlugin(plugin.id);
        return { ok: true };
      },
      'plugin.self.visibility',
    );
    this.registerHandler(
      'plugin:hide',
      ({ plugin }) => {
        this.pluginManager.hidePlugin(plugin.id);
        return { ok: true };
      },
      'plugin.self.visibility',
    );

    // plugin:saveState / plugin:restoreState —— 自身状态持久化（RFC-002 §6）。
    this.registerHandler(
      'plugin:saveState',
      ({ plugin, params }) => {
        const payload = isRecord(params) ? params['payload'] : undefined;
        try {
          this.pluginManager.saveState(plugin.id, payload);
          return { ok: true };
        } catch (e) {
          if (e instanceof PluginManagerError) {
            const err: CodedError = {
              code: e.code as ErrorCode,
              message: e.message,
            };
            throw err;
          }
          throw e;
        }
      },
      'plugin.self.state',
    );
    this.registerHandler(
      'plugin:restoreState',
      ({ plugin }) => ({ payload: this.pluginManager.loadState(plugin.id) ?? null }),
      'plugin.self.state',
    );

    // http:request —— 经 HttpClient 代理（Runtime 侧附加 token，RFC-003 §3.3）。
    this.registerHandler(
      'http:request',
      async ({ params }) => {
        const req = parseHttpRequest(params);
        return await this.httpClient.request(req);
      },
      'runtime.network',
    );

    // ws:* —— WebSocketManager（单连接共享，RFC-003 §3.2）。
    this.registerHandler(
      'ws:send',
      ({ params }) => {
        const channel = getStringField(params, 'channel');
        if (channel === undefined) {
          throw new RouterError(
            'INVALID_PARAMS',
            'ws:send requires { channel: string, data?: unknown }',
          );
        }
        const data = isRecord(params) ? params['data'] : undefined;
        this.webSocketManager.send(channel, data);
        return { ok: true };
      },
      'runtime.websocket',
    );

    // ws:state —— 纯读，不需 capability。
    this.registerHandler('ws:state', () => ({
      state: this.webSocketManager.state,
    }));
  }

  // ── 订阅管理 ─────────────────────────────────────────────────────────

  private subscribeForPlugin(plugin: PluginInstance, eventName: string): void {
    let perPlugin = this.subscriptions.get(plugin.id);
    if (!perPlugin) {
      perPlugin = new Map();
      this.subscriptions.set(plugin.id, perPlugin);
    }
    if (perPlugin.has(eventName)) {
      // 已订阅：保持幂等，不重复挂回调，不重复发 push。
      return;
    }
    const unsub = this.eventBus.subscribeForPlugin(
      plugin.id,
      eventName,
      (payload) => {
        const push: PushMessage = {
          type: 'reui:push',
          version: PROTOCOL_VERSION,
          event: eventName,
          payload,
        };
        plugin.postMessage(push);
      },
    );
    perPlugin.set(eventName, unsub);
  }

  private unsubscribeForPlugin(pluginId: string, eventName: string): void {
    const perPlugin = this.subscriptions.get(pluginId);
    if (!perPlugin) return;
    const unsub = perPlugin.get(eventName);
    if (!unsub) return;
    unsub();
    perPlugin.delete(eventName);
    if (perPlugin.size === 0) this.subscriptions.delete(pluginId);
  }

  private cleanupPluginSubscriptions(pluginId: string): void {
    const perPlugin = this.subscriptions.get(pluginId);
    if (!perPlugin) return;
    for (const unsub of perPlugin.values()) unsub();
    perPlugin.clear();
    this.subscriptions.delete(pluginId);
  }

  // ── 回包工具 ─────────────────────────────────────────────────────────

  private sendHandshakeReject(
    plugin: PluginInstance,
    code: HandshakeRejectCode,
    reason: string,
  ): void {
    const reject: HandshakeRejectMessage = {
      type: 'reui:handshake-reject',
      version: PROTOCOL_VERSION,
      payload: { reason, code },
    };
    plugin.postMessage(reject);
  }

  private sendSuccess(
    plugin: PluginInstance,
    id: string,
    result: unknown,
  ): void {
    const msg: SuccessResponseMessage = {
      type: 'reui:response',
      version: PROTOCOL_VERSION,
      id,
      success: true,
      result,
    };
    plugin.postMessage(msg);
  }

  private sendError(
    plugin: PluginInstance,
    id: string,
    code: ErrorCode,
    message: string,
    details?: unknown,
  ): void {
    const msg: ErrorResponseMessage = {
      type: 'reui:response',
      version: PROTOCOL_VERSION,
      id,
      success: false,
      error:
        details === undefined
          ? { code, message }
          : { code, message, details },
    };
    plugin.postMessage(msg);
  }
}

// ── 局部辅助 ─────────────────────────────────────────────────────────────

function getRuntimeOrigin(plugin: PluginInstance): string {
  // 在浏览器/jsdom 中 window.location.origin 总是非空字符串；
  // 极端情况下（未来如果在 worker 中跑）回退到插件自己的 origin——
  // PluginManager 的 URL 构造保证 plugin.origin 也是非空字符串。
  if (typeof window !== 'undefined' && window.location) {
    const o = window.location.origin;
    if (typeof o === 'string' && o.length > 0) return o;
  }
  return plugin.origin;
}

const HTTP_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
]);

/** 校验并归一化 `http:request` 的 params。非法时抛 INVALID_PARAMS。 */
function parseHttpRequest(params: unknown): HttpRequestConfig {
  const url = getStringField(params, 'url');
  if (url === undefined) {
    throw new RouterError(
      'INVALID_PARAMS',
      'http:request requires { url: string, method?, data?, headers?, params?, timeout? }',
    );
  }
  const record = isRecord(params) ? params : {};

  let method: HttpMethod = 'GET';
  const rawMethod = record['method'];
  if (typeof rawMethod === 'string') {
    const upper = rawMethod.toUpperCase();
    if (!HTTP_METHODS.has(upper as HttpMethod)) {
      throw new RouterError(
        'INVALID_PARAMS',
        `http:request method '${rawMethod}' is not supported`,
      );
    }
    method = upper as HttpMethod;
  }

  const req: HttpRequestConfig = { url, method };
  if ('data' in record) req.data = record['data'];
  if (isRecord(record['headers'])) {
    req.headers = record['headers'] as Record<string, string>;
  }
  if (isRecord(record['params'])) {
    req.params = record['params'] as Record<string, unknown>;
  }
  if (typeof record['timeout'] === 'number') req.timeout = record['timeout'];
  return req;
}

function toErrorResponse(err: unknown): {
  code: ErrorCode;
  message: string;
  details?: unknown;
} {
  if (err instanceof RouterError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (isCodedError(err)) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof Error) {
    return { code: 'RUNTIME_ERROR', message: err.message };
  }
  return { code: 'RUNTIME_ERROR', message: String(err) };
}

const devWarn = (message: string, ...args: unknown[]): void => {
  if (
    typeof process !== 'undefined' &&
    process.env != null &&
    process.env.NODE_ENV !== 'production'
  ) {
    // eslint-disable-next-line no-console
    console.warn(`[ReUI:Router] ${message}`, ...args);
  }
};
